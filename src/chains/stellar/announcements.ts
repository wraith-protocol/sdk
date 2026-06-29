import type { Announcement, Network } from './types';
import { bytesToHex, extractMemo } from './utils';
import { getDeployment } from './deployments';
import type { StellarChainDeployment } from './deployments';
import {
  buildV1AnnouncerEventFilter,
  buildV2AllBucketsEventFilter,
  buildV2BucketEventFilterBatches,
  type SorobanEventFilter,
} from './event-filters';
import { Address, xdr } from '@stellar/stellar-sdk';

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
  /**
   * View-tag buckets (0–255) to query on the v2 announcer via RPC topic filters.
   * When omitted, all v2 buckets are fetched with `("announce", 2, *, *)`.
   */
  viewTagBuckets?: number[];
  /** Fetch the legacy v1 announcer stream (default: `true`). */
  includeV1?: boolean;
  /** Fetch the v2 announcer when `announcerV2` is configured (default: `true`). */
  includeV2?: boolean;
  /** Override the Soroban RPC URL. */
  sorobanUrl?: string;
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
 * Streaming version of announcement fetching. Yields announcements page by page
 * from the Soroban RPC as they arrive, never holding more than one page in memory.
 *
 * Cancellation is automatic: breaking out of the `for-await` loop stops the stream.
 *
 * @param chain The chain identifier (default: "stellar").
 * @param sorobanUrlOrOpts Optional override for the Soroban RPC URL, or FetchAnnouncementsOptions.
 * @param maybeOpts Optional FetchAnnouncementsOptions if URL was provided as second arg.
 */
export async function* fetchAnnouncementsStream(
  chain: string = 'stellar',
  sorobanUrlOrOpts?: string | FetchAnnouncementsOptions,
  maybeOpts?: FetchAnnouncementsOptions,
): AsyncGenerator<Announcement> {
  const deployment = getDeployment(chain);
  const opts = typeof sorobanUrlOrOpts === 'object' ? sorobanUrlOrOpts : maybeOpts;
  const sorobanUrl =
    (typeof sorobanUrlOrOpts === 'string' ? sorobanUrlOrOpts : opts?.sorobanUrl) ||
    deployment.sorobanUrl;
  const announcerContract = deployment.contracts.announcer;
  const filterGroups = buildFilterGroups(deployment, opts);

  if (filterGroups.length === 0) return;

  if (opts?.fromLedger !== undefined && opts.fromTimestamp !== undefined) {
    throw new Error('fromLedger and fromTimestamp are mutually exclusive');
  }
  if (opts?.toLedger !== undefined && opts.toTimestamp !== undefined) {
    throw new Error('toLedger and toTimestamp are mutually exclusive');
  }

  const ledgerWindow = await getSorobanLedgerWindow(sorobanUrl, announcerContract);
  const latestLedger = ledgerWindow.latest ?? (await getLatestLedger(sorobanUrl));
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
  const seen = new Set<string>();
  const singleFilterGroup = filterGroups.length === 1;

  for (const filters of filterGroups) {
    let hasMore = true;
    let groupCursor = singleFilterGroup ? cursor : undefined;

    while (hasMore) {
      const params: Record<string, unknown> = {
        filters,
        pagination: groupCursor ? { limit: 1000, cursor: groupCursor } : { limit: 1000 },
      };

      if (!groupCursor) {
        params.startLedger = startLedger;
      }

      const res = await fetch(sorobanUrl, {
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
        if (range && !groupCursor && startLedger < range.oldest) {
          throw new RetentionExceededError(startLedger, range.oldest);
        }
        // If we get a range error and we aren't exceeding retention, just break for this filter
        // (This matches develop's original behavior where it breaks and moves to the next filter)
        break;
      }

      const events = data.result?.events ?? [];

      for (const event of events) {
        const ledger = eventLedger(event);
        if (toLedger !== undefined && ledger !== undefined && ledger >= toLedger) {
          hasMore = false;
          continue;
        }

        const dedupeKey = String(event.id ?? `${event.txHash}:${JSON.stringify(event.topic)}`);
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const ann = parseAnnouncementEvent(event);
        if (ann) yield ann;
      }

      if (!hasMore || events.length < 1000) {
        hasMore = false;
      } else {
        groupCursor = data.result?.cursor;
        if (!groupCursor) hasMore = false;
      }
    }
  }
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

function buildFilterGroups(
  deployment: StellarChainDeployment,
  opts?: FetchAnnouncementsOptions,
): SorobanEventFilter[][] {
  const includeV1 = opts?.includeV1 ?? true;
  const includeV2 = opts?.includeV2 ?? true;
  const announcerV2 = deployment.contracts.announcerV2;
  const groups: SorobanEventFilter[][] = [];

  if (includeV1) {
    groups.push([buildV1AnnouncerEventFilter(deployment.contracts.announcer)]);
  }

  if (includeV2 && announcerV2) {
    if (opts?.viewTagBuckets && opts.viewTagBuckets.length > 0) {
      groups.push(...buildV2BucketEventFilterBatches(announcerV2, opts.viewTagBuckets));
    } else {
      groups.push([buildV2AllBucketsEventFilter(announcerV2)]);
    }
  }

  return groups;
}

function parseLedgerRange(message: string): { oldest: number; latest: number } | undefined {
  const match = message.match(/range:\s*(\d+)\s*-\s*(\d+)/);
  if (!match) return undefined;
  return {
    oldest: parseInt(match[1], 10),
    latest: parseInt(match[2], 10),
  };
}

/** @internal Exported for unit tests. */
export function parseAnnouncementEvent(event: Record<string, unknown>): Announcement | null {
  try {
    const topics = event.topic as string[] | undefined;
    if (!topics || topics.length < 3) return null;

    let ann: Announcement | null = null;
    if (topics.length === 3) {
      ann = parseV1AnnouncementEvent(event, topics);
    } else if (topics.length === 4) {
      ann = parseV2AnnouncementEvent(event, topics);
    }

    if (ann) {
      const memo = extractMemo(event as { memo_type?: string; memo?: string });
      if (memo) ann = { ...ann, memo };
    }

    return ann;
  } catch {
    return null;
  }
}

function parseV1AnnouncementEvent(
  event: Record<string, unknown>,
  topics: string[],
): Announcement | null {
  const schemeIdScVal = xdr.ScVal.fromXDR(topics[1], 'base64');
  const stealthScVal = xdr.ScVal.fromXDR(topics[2], 'base64');
  const stealthAddress = Address.fromScAddress(stealthScVal.address()).toString();

  const valueScVal = xdr.ScVal.fromXDR(event.value as string, 'base64');
  const valueVec = valueScVal.vec();
  if (!valueVec || valueVec.length < 3) return null;

  const caller = Address.fromScAddress(valueVec[0].address()).toString();
  const ephPubKeyBytes = valueVec[1].bytes();
  const metadataBytes = valueVec[2].bytes();
  if (!ephPubKeyBytes || !metadataBytes) return null;

  return {
    schemeId: schemeIdScVal.u32(),
    stealthAddress,
    caller,
    ephemeralPubKey: bytesToHex(new Uint8Array(ephPubKeyBytes)),
    metadata: bytesToHex(new Uint8Array(metadataBytes)),
    viewTagBucket: undefined,
  };
}

function parseV2AnnouncementEvent(
  event: Record<string, unknown>,
  topics: string[],
): Announcement | null {
  const schemeIdScVal = xdr.ScVal.fromXDR(topics[1], 'base64');
  const bucketScVal = xdr.ScVal.fromXDR(topics[2], 'base64');

  const valueScVal = xdr.ScVal.fromXDR(event.value as string, 'base64');
  const valueVec = valueScVal.vec();
  if (!valueVec || valueVec.length < 3) return null;

  const stealthAddress = Address.fromScAddress(valueVec[0].address()).toString();
  const ephPubKeyBytes = valueVec[1].bytes();
  const metadataBytes = valueVec[2].bytes();
  if (!ephPubKeyBytes || !metadataBytes) return null;

  const caller =
    typeof event.contractId === 'string'
      ? event.contractId
      : typeof event.contract_id === 'string'
        ? event.contract_id
        : '';

  return {
    schemeId: schemeIdScVal.u32(),
    stealthAddress,
    caller,
    ephemeralPubKey: bytesToHex(new Uint8Array(ephPubKeyBytes)),
    metadata: bytesToHex(new Uint8Array(metadataBytes)),
    viewTagBucket: bucketScVal.u32(),
  };
}

function eventLedger(event: Record<string, unknown>): number | undefined {
  const ledger = event.ledger;
  return typeof ledger === 'number' ? ledger : undefined;
}
