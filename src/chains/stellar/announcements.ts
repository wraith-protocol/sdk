import type { Announcement } from './types';
import { bytesToHex } from './utils';
import { getDeployment } from './deployments';

let stellarSdkPromise: Promise<typeof import('@stellar/stellar-sdk')> | undefined;

function loadStellarSdk(): Promise<typeof import('@stellar/stellar-sdk')> {
  stellarSdkPromise ??= import('@stellar/stellar-sdk');
  return stellarSdkPromise;
}

export interface FetchAnnouncementsOptions {
  /** Earliest ledger to include, inclusive. Ignored when cursor is provided. */
  fromLedger?: number;
  /** Latest ledger to include, exclusive. Defaults to the latest known ledger. */
  toLedger?: number;
  /** Convenience lower bound converted to a ledger sequence through Horizon. */
  fromTimestamp?: Date;
  /** Convenience upper bound converted to a ledger sequence through Horizon. */
  toTimestamp?: Date;
  /** Soroban RPC pagination cursor returned by a previous scan. */
  cursor?: string;
}

export interface FetchAnnouncementsResult {
  announcements: Announcement[];
  nextCursor?: string;
}

export class RetentionExceededError extends Error {
  readonly requestedLedger: number;
  readonly oldestAvailableLedger: number;

  constructor(requestedLedger: number, oldestAvailableLedger: number) {
    super(
      `Requested Stellar ledger ${requestedLedger} is older than the Soroban retention window. Oldest available ledger is ${oldestAvailableLedger}.`,
    );
    this.name = 'RetentionExceededError';
    this.requestedLedger = requestedLedger;
    this.oldestAvailableLedger = oldestAvailableLedger;
  }
}

/**
 * Fetches Stellar stealth announcements from the configured Soroban RPC.
 *
 * Use this before {@link scanAnnouncements} when a recipient wants to discover
 * incoming payments. The helper queries the configured announcer contract with
 * `getEvents`, handles pagination, and parses event XDR into SDK announcement
 * objects.
 *
 * @param chain - Deployment key from {@link DEPLOYMENTS}; defaults to `stellar`.
 * @param sorobanUrl - Optional Soroban RPC URL override.
 * @returns Parsed announcements from the selected announcer contract.
 * @throws {Error} If the deployment key is unknown or the RPC request fails before returning JSON.
 *
 * @example
 * ```ts
 * import { fetchAnnouncements, scanAnnouncements } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const announcements = await fetchAnnouncements("stellar");
 * const matches = scanAnnouncements(
 *   announcements,
 *   keys.viewingKey,
 *   keys.spendingPubKey,
 *   keys.spendingScalar,
 * );
 * ```
 *
 * @see {@link getDeployment}
 */
export async function fetchAnnouncements(
  chain?: string,
  sorobanUrl?: string,
): Promise<Announcement[]>;
export async function fetchAnnouncements(
  chain: string,
  opts: FetchAnnouncementsOptions,
): Promise<FetchAnnouncementsResult>;
export async function fetchAnnouncements(
  chain: string,
  sorobanUrl: string,
  opts: FetchAnnouncementsOptions,
): Promise<FetchAnnouncementsResult>;
export async function fetchAnnouncements(
  chain: string = 'stellar',
  sorobanUrlOrOpts?: string | FetchAnnouncementsOptions,
  maybeOpts?: FetchAnnouncementsOptions,
): Promise<Announcement[] | FetchAnnouncementsResult> {
  const deployment = getDeployment(chain);
  const opts = typeof sorobanUrlOrOpts === 'object' ? sorobanUrlOrOpts : maybeOpts;
  const returnsCursor = Boolean(opts);
  const sorobanUrl = typeof sorobanUrlOrOpts === 'string' ? sorobanUrlOrOpts : undefined;
  const url = sorobanUrl || deployment.sorobanUrl;
  const announcerContract = deployment.contracts.announcer;
  const all: Announcement[] = [];

  if (opts?.fromLedger !== undefined && opts.fromTimestamp !== undefined) {
    throw new Error('fromLedger and fromTimestamp are mutually exclusive');
  }
  if (opts?.toLedger !== undefined && opts.toTimestamp !== undefined) {
    throw new Error('toLedger and toTimestamp are mutually exclusive');
  }

  const ledgerWindow = await getSorobanLedgerWindow(url, announcerContract);
  const latestLedger = ledgerWindow.latest ?? (await getLatestLedger(url));
  let startLedger =
    opts?.fromLedger ?? Math.max(ledgerWindow.oldest ?? 1, latestLedger ? latestLedger - 5000 : 1);
  let toLedger = opts?.toLedger ?? latestLedger;

  if (opts?.fromTimestamp) {
    startLedger = await ledgerForTimestamp(deployment.horizonUrl, opts.fromTimestamp);
  }
  if (opts?.toTimestamp) {
    toLedger = await ledgerForTimestamp(deployment.horizonUrl, opts.toTimestamp);
  }

  if (!opts?.cursor && ledgerWindow.oldest !== undefined && startLedger < ledgerWindow.oldest) {
    throw new RetentionExceededError(startLedger, ledgerWindow.oldest);
  }

  let cursor = opts?.cursor;
  let nextCursor: string | undefined = cursor;
  let hasMore = true;

  while (hasMore) {
    const params: Record<string, unknown> = {
      filters: [{ type: 'contract', contractIds: [announcerContract] }],
      pagination: cursor ? { limit: 1000, cursor } : { limit: 1000 },
    };

    if (!cursor) {
      params.startLedger = startLedger;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'getEvents',
        params,
      }),
    });

    const data = await res.json();
    if (data.error?.message) {
      const range = parseLedgerRange(data.error.message);
      if (range && !opts?.cursor && startLedger < range.oldest) {
        throw new RetentionExceededError(startLedger, range.oldest);
      }
      break;
    }

    const events = data.result?.events ?? [];

    for (const event of events) {
      const ledger = eventLedger(event);
      if (toLedger !== undefined && ledger !== undefined && ledger >= toLedger) {
        hasMore = false;
        continue;
      }
      const ann = await parseAnnouncementEvent(event);
      if (ann) all.push(ann);
    }

    nextCursor = data.result?.cursor ?? cursor;
    if (!hasMore || events.length < 1000) {
      hasMore = false;
    } else {
      cursor = data.result?.cursor;
      if (!cursor) hasMore = false;
    }
  }

  return returnsCursor ? { announcements: all, nextCursor } : all;
}

async function getSorobanLedgerWindow(
  sorobanUrl: string,
  announcerContract: string,
): Promise<{ oldest?: number; latest?: number }> {
  const probeRes = await fetch(sorobanUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'getEvents',
      params: {
        startLedger: 1,
        filters: [{ type: 'contract', contractIds: [announcerContract] }],
        pagination: { limit: 1 },
      },
    }),
  });

  const probeData = await probeRes.json();
  if (probeData.error?.message) {
    return parseLedgerRange(probeData.error.message) ?? {};
  }
  return {};
}

async function getLatestLedger(sorobanUrl: string): Promise<number | undefined> {
  const res = await fetch(sorobanUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }),
  });
  const data = await res.json();
  return data.result?.sequence;
}

async function ledgerForTimestamp(horizonUrl: string, timestamp: Date): Promise<number> {
  const latest = await horizonLedger(horizonUrl, 'latest');
  let low = 1;
  let high = latest.sequence;
  let answer = latest.sequence + 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const ledger = await horizonLedger(horizonUrl, mid);
    const closedAt = Date.parse(ledger.closed_at);

    if (closedAt >= timestamp.getTime()) {
      answer = ledger.sequence;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return answer;
}

async function horizonLedger(
  horizonUrl: string,
  sequence: number | 'latest',
): Promise<{ sequence: number; closed_at: string }> {
  const path =
    sequence === 'latest'
      ? '/ledgers?order=desc&limit=1'
      : `/ledgers/${encodeURIComponent(sequence)}`;
  const res = await fetch(`${horizonUrl}${path}`);
  const data = await res.json();
  if (sequence === 'latest') {
    return data._embedded.records[0];
  }
  return data;
}

function parseLedgerRange(message: string): { oldest: number; latest: number } | undefined {
  const match = message.match(/range:\s*(\d+)\s*-\s*(\d+)/);
  if (!match) return undefined;
  return {
    oldest: parseInt(match[1], 10),
    latest: parseInt(match[2], 10),
  };
}

async function parseAnnouncementEvent(
  event: Record<string, unknown>,
): Promise<Announcement | null> {
  try {
    const { xdr, Address } = await loadStellarSdk();

    const topics = event.topic as string[];
    if (!topics || topics.length < 3) return null;

    const schemeIdScVal = xdr.ScVal.fromXDR(topics[1], 'base64');
    const stealthScVal = xdr.ScVal.fromXDR(topics[2], 'base64');
    const stealthAddress = Address.fromScAddress(stealthScVal.address()).toString();

    const valueScVal = xdr.ScVal.fromXDR(event.value as string, 'base64');
    const valueVec = valueScVal.vec();
    if (!valueVec || valueVec.length < 3) return null;

    const caller = Address.fromScAddress(valueVec[0].address()).toString();
    const ephPubKeyBytes = valueVec[1].bytes();
    const viewTagBytes = valueVec[2].bytes();
    if (!ephPubKeyBytes || !viewTagBytes) return null;

    return {
      schemeId: schemeIdScVal.u32(),
      stealthAddress,
      caller,
      ephemeralPubKey: bytesToHex(new Uint8Array(ephPubKeyBytes)),
      metadata: bytesToHex(new Uint8Array(viewTagBytes)),
    };
  } catch {
    return null;
  }
}

function eventLedger(event: Record<string, unknown>): number | undefined {
  const ledger = event.ledger;
  return typeof ledger === 'number' ? ledger : undefined;
}
