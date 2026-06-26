import type { Announcement } from './types';
import type { AnnouncementCache } from './cache';
import { bytesToHex } from './utils';
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
   * When omitted, all v2 buckets are fetched with `(\"announce\", 2, *, *)`.
   */
  viewTagBuckets?: number[];
  /** Fetch the legacy v1 announcer stream (default: `true`). */
  includeV1?: boolean;
  /** Fetch the v2 announcer when `announcerV2` is configured (default: `true`). */
  includeV2?: boolean;
  /** Override the Soroban RPC URL. */
  sorobanUrl?: string;
  /** Reserved for cache-aware callers. */
  bypassCache?: boolean;
  /** Reserved for cache-aware callers. */
  cache?: AnnouncementCache;
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
 * Fetches stealth address announcements from the Soroban RPC for the given
 * Stellar network, using an announcement cache to avoid redundant RPC traffic.
 *
 * On the first call the full available window is fetched. On subsequent calls
 * only the delta since the last seen ledger is fetched, and results are merged
 * with cached data before being returned.
 *
 * @param chain The chain identifier (default: `"stellar"`).
 * @param options Fetch options including cache bypass and custom cache.
 * @returns Array of all known announcements (cached + fresh).
 */
/**
 * Fetches Stellar stealth announcements from the configured Soroban RPC.
 *
 * The legacy overloads return a plain array for backward compatibility. Passing
 * an options object enables ledger windows, pagination cursors, and a structured
 * `{ announcements, nextCursor }` result.
 */
export async function fetchAnnouncements(): Promise<Announcement[]>;
export async function fetchAnnouncements(chain: string): Promise<Announcement[]>;
export async function fetchAnnouncements(
  chain: string,
  sorobanUrl: string,
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
  if (!isFetchOptions(sorobanUrlOrOpts) && !isFetchOptions(maybeOpts)) {
    const sorobanUrl = typeof sorobanUrlOrOpts === 'string' ? sorobanUrlOrOpts : undefined;
    return collectAnnouncements(fetchAnnouncementsStream(chain, sorobanUrl));
  }

  const sorobanUrl = typeof sorobanUrlOrOpts === 'string' ? sorobanUrlOrOpts : undefined;
  const opts = normalizeFetchOptions(sorobanUrlOrOpts, maybeOpts);
  return fetchAnnouncementsWithOptions(chain, sorobanUrl ?? opts.sorobanUrl, opts);
}

/**
 * Streaming version of announcement fetching. Yields announcements page by page
 * from the Soroban RPC as they arrive, never holding more than one page in memory.
 *
 * Cancellation is automatic: breaking out of the `for-await` loop stops the stream.
 */
export async function* fetchAnnouncementsStream(
  chain: string = 'stellar',
  sorobanUrl?: string,
): AsyncGenerator<Announcement> {
  const deployment = getDeployment(chain);
  const url = sorobanUrl || deployment.sorobanUrl;
  const announcerContract = deployment.contracts.announcer;

  const probeData = await postJson(url, {
    jsonrpc: '2.0',
    id: 0,
    method: 'getEvents',
    params: {
      startLedger: 1,
      filters: [{ type: 'contract', contractIds: [announcerContract] }],
      pagination: { limit: 1 },
    },
  });

  let startLedger = 1;

  if (probeData.error?.message) {
    const range = parseLedgerRange(probeData.error.message);
    if (!range) {
      return;
    }
    startLedger = defaultStartLedger(range.oldest, range.latest);
  }

  let cursor: string | undefined;

  while (true) {
    const params: Record<string, unknown> = {
      filters: [{ type: 'contract', contractIds: [announcerContract] }],
      pagination: cursor ? { limit: 1000, cursor } : { limit: 1000 },
    };

    if (!cursor) {
      params.startLedger = startLedger;
    }

    const data = await postJson(url, {
      jsonrpc: '2.0',
      id: 2,
      method: 'getEvents',
      params,
    });

    const events = asEvents(data.result?.events);
    for (const event of events) {
      const announcement = parseAnnouncementEvent(event);
      if (announcement) {
        yield announcement;
      }
    }

    if (events.length < 1000) {
      return;
    }

    cursor = typeof data.result?.cursor === 'string' ? data.result.cursor : undefined;
    if (!cursor) {
      return;
    }
  }
}

async function fetchAnnouncementsWithOptions(
  chain: string,
  sorobanUrl: string | undefined,
  opts: FetchAnnouncementsOptions,
): Promise<FetchAnnouncementsResult> {
  validateFetchOptions(opts);

  const deployment = getDeployment(chain);
  const url = sorobanUrl || deployment.sorobanUrl;
  const filterGroups = buildFilterGroups(deployment, opts);

  if (filterGroups.length === 0) {
    return { announcements: [], nextCursor: undefined };
  }

  const ledgerWindow = await getSorobanLedgerWindow(url, deployment.contracts.announcer);
  const latestLedger =
    ledgerWindow.latest !== undefined ? ledgerWindow.latest : await getLatestLedger(url);

  let startLedger =
    opts.fromLedger ?? defaultStartLedger(ledgerWindow.oldest, latestLedger ?? undefined);
  let toLedger = opts.toLedger ?? latestLedger ?? undefined;

  if (opts.fromTimestamp) {
    startLedger = await ledgerForTimestamp(deployment.horizonUrl, opts.fromTimestamp);
  }

  if (opts.toTimestamp) {
    toLedger = await ledgerForTimestamp(deployment.horizonUrl, opts.toTimestamp);
  }

  if (!opts.cursor && ledgerWindow.oldest !== undefined && startLedger < ledgerWindow.oldest) {
    throw new RetentionExceededError(startLedger, ledgerWindow.oldest);
  }

  const announcements: Announcement[] = [];
  const seen = new Set<string>();
  const singleFilterGroup = filterGroups.length === 1;
  let nextCursor = opts.cursor;

  for (const filters of filterGroups) {
    let groupCursor = singleFilterGroup ? opts.cursor : undefined;
    let hasMore = true;

    while (hasMore) {
      const params: Record<string, unknown> = {
        filters,
        pagination: groupCursor ? { limit: 1000, cursor: groupCursor } : { limit: 1000 },
      };

      if (!groupCursor) {
        params.startLedger = startLedger;
      }

      const data = await postJson(url, {
        jsonrpc: '2.0',
        id: 2,
        method: 'getEvents',
        params,
      });

      if (data.error?.message) {
        const range = parseLedgerRange(data.error.message);
        if (range && !groupCursor && startLedger < range.oldest) {
          throw new RetentionExceededError(startLedger, range.oldest);
        }
        break;
      }

      const events = asEvents(data.result?.events);

      for (const event of events) {
        const ledger = eventLedger(event);
        if (toLedger !== undefined && ledger !== undefined && ledger >= toLedger) {
          hasMore = false;
          continue;
        }

        const dedupeKey = eventDedupeKey(event);
        if (seen.has(dedupeKey)) {
          continue;
        }
        seen.add(dedupeKey);

        const announcement = parseAnnouncementEvent(event);
        if (announcement) {
          announcements.push(announcement);
        }
      }

      if (singleFilterGroup) {
        nextCursor = typeof data.result?.cursor === 'string' ? data.result.cursor : groupCursor;
      }

      if (!hasMore || events.length < 1000) {
        hasMore = false;
      } else {
        groupCursor = typeof data.result?.cursor === 'string' ? data.result.cursor : undefined;
        if (!groupCursor) {
          hasMore = false;
        }
      }
    }
  }

  return { announcements, nextCursor };
}

async function collectAnnouncements(source: AsyncIterable<Announcement>): Promise<Announcement[]> {
  const announcements: Announcement[] = [];
  for await (const announcement of source) {
    announcements.push(announcement);
  }
  return announcements;
}

  // ------------------------------------------------------------------
  // Cache integration
  // ------------------------------------------------------------------
  let fetchFromLedger = windowStart;
  let resumeCursor: string | undefined;
  // ------------------------------------------------------------------
  // Fetch delta from RPC
  // ------------------------------------------------------------------
  for await (const ann of fetchRange(url, announcerContract, fetchFromLedger, resumeCursor)) {
    yield ann;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function* fetchRange(
  url: string,
  announcerContract: string,
  startLedger: number,
  resumeCursor?: string,
): AsyncGenerator<Announcement> {
  let cursor = resumeCursor;
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
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'getEvents', params }),
    });

    const data = await res.json();
    const events: Record<string, unknown>[] = data.result?.events ?? [];

    for (const event of events) {
      const ann = parseAnnouncementEvent(event);
      if (ann) {
        yield ann;
      }
    }

    if (events.length < 1000) {
      hasMore = false;
    } else {
      cursor = data.result?.cursor as string | undefined;
      if (!cursor) hasMore = false;
    }
  }
  return Math.max(oldest ?? 1, latest - 5000);
}
async function getSorobanLedgerWindow(
  sorobanUrl: string,
  announcerContract: string,
): Promise<{ oldest?: number; latest?: number }> {
  const probeData = await postJson(sorobanUrl, {
    jsonrpc: '2.0',
    id: 0,
    method: 'getEvents',
    params: {
      startLedger: 1,
      filters: [{ type: 'contract', contractIds: [announcerContract] }],
      pagination: { limit: 1 },
    },
  });

  if (probeData.error?.message) {
    return parseLedgerRange(probeData.error.message) ?? {};
  }

  return {};
}

async function getLatestLedger(sorobanUrl: string): Promise<number | undefined> {
  const data = await postJson(sorobanUrl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'getLatestLedger',
  });
  return typeof data.result?.sequence === 'number' ? data.result.sequence : undefined;
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
  if (!match) {
    return undefined;
  }

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

    if (topics.length === 3) {
      return parseV1AnnouncementEvent(event, topics);
    }

    if (topics.length === 4) {
      return parseV2AnnouncementEvent(event, topics);
    }

    return null;
  } catch {
    return null;
  }
}

function parseV1AnnouncementEvent(
  event: Record<string, unknown>,
  topics: unknown[],
): Announcement | null {
  const schemeIdScVal = xdr.ScVal.fromXDR(String(topics[1]), 'base64');
  const stealthScVal = xdr.ScVal.fromXDR(String(topics[2]), 'base64');
  const stealthAddress = Address.fromScAddress(stealthScVal.address()).toString();

  const valueScVal = xdr.ScVal.fromXDR(String(event.value), 'base64');
  const valueVec = valueScVal.vec();
  if (!valueVec || valueVec.length < 3) {
    return null;
  }

  const caller = Address.fromScAddress(valueVec[0].address()).toString();
  const ephPubKeyBytes = valueVec[1].bytes();
  const metadataBytes = valueVec[2].bytes();
  if (!ephPubKeyBytes || !metadataBytes) {
    return null;
  }

  const ledger = eventLedger(event);
  return {
    schemeId: schemeIdScVal.u32(),
    stealthAddress,
    caller,
    ephemeralPubKey: bytesToHex(new Uint8Array(ephPubKeyBytes)),
    metadata: bytesToHex(new Uint8Array(metadataBytes)),
    viewTagBucket: undefined,
    ...(ledger === undefined ? {} : { ledger }),
  };
}

function parseV2AnnouncementEvent(
  event: Record<string, unknown>,
  topics: unknown[],
): Announcement | null {
  const schemeIdScVal = xdr.ScVal.fromXDR(String(topics[1]), 'base64');
  const bucketScVal = xdr.ScVal.fromXDR(String(topics[2]), 'base64');

  const valueScVal = xdr.ScVal.fromXDR(String(event.value), 'base64');
  const valueVec = valueScVal.vec();
  if (!valueVec || valueVec.length < 3) {
    return null;
  }

  const stealthAddress = Address.fromScAddress(valueVec[0].address()).toString();
  const ephPubKeyBytes = valueVec[1].bytes();
  const metadataBytes = valueVec[2].bytes();
  if (!ephPubKeyBytes || !metadataBytes) {
    return null;
  }

  const caller =
    typeof event.contractId === 'string'
      ? event.contractId
      : typeof event.contract_id === 'string'
        ? event.contract_id
        : '';

  const ledger = eventLedger(event);
  return {
    schemeId: schemeIdScVal.u32(),
    stealthAddress,
    caller,
    ephemeralPubKey: bytesToHex(new Uint8Array(ephPubKeyBytes)),
    metadata: bytesToHex(new Uint8Array(metadataBytes)),
    viewTagBucket: bucketScVal.u32(),
    ...(ledger === undefined ? {} : { ledger }),
  };
}

function eventDedupeKey(event: Record<string, unknown>): string {
  if (typeof event.id === 'string' || typeof event.id === 'number') {
    return String(event.id);
  }
  if (typeof event.txHash === 'string') {
    return `${event.txHash}:${JSON.stringify(event.topic ?? null)}`;
  }
  return JSON.stringify(event);
}

function eventLedger(event: Record<string, unknown>): number | undefined {
  if (typeof event.ledger === 'number') {
    return event.ledger;
  }
  if (typeof event.ledger === 'string') {
    const parsed = parseInt(event.ledger, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function asEvents(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (event): event is Record<string, unknown> => typeof event === 'object' && event !== null,
  );
}

async function postJson(url: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}
