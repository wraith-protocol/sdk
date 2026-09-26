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
  /**
   * Number of parallel chunks to fetch for cold scans. Splits the ledger range
   * into N contiguous chunks fetched concurrently, then merged in order.
   * Default: 1 (sequential). Ignored when cursor is provided.
   */
  parallelism?: number;
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

export interface AnnouncementParseContext {
  endpoint?: string;
  eventId?: unknown;
}

/** A malformed RPC envelope or announcement event payload. */
export class AnnouncementParseError extends Error {
  readonly endpoint?: string;
  readonly eventId?: string;
  readonly field: string;

  constructor(message: string, field: string, context: AnnouncementParseContext = {}) {
    const endpoint = context.endpoint ? ` endpoint=${safeEndpoint(context.endpoint)}` : '';
    const eventId =
      context.eventId !== undefined ? ` event=${safeContextValue(context.eventId)}` : '';
    super(`Invalid Stellar RPC payload:${endpoint}${eventId} field=${field}: ${message}`);
    this.name = 'AnnouncementParseError';
    this.endpoint = context.endpoint === undefined ? undefined : safeEndpoint(context.endpoint);
    this.eventId = context.eventId === undefined ? undefined : safeContextValue(context.eventId);
    this.field = field;
  }
}

function safeContextValue(value: unknown): string {
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 200);
}

function safeEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.origin}${url.pathname}`.slice(0, 300);
  } catch {
    return endpoint.split(/[?#]/, 1)[0].slice(0, 300);
  }
}

function invalidPayload(
  message: string,
  field: string,
  context: AnnouncementParseContext,
): AnnouncementParseError {
  return new AnnouncementParseError(message, field, context);
}

function assertRpcEnvelope(payload: unknown, endpoint: string): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalidPayload('JSON-RPC response must be an object', 'envelope', { endpoint });
  }

  const data = payload as Record<string, unknown>;
  if (data.jsonrpc !== '2.0') {
    throw invalidPayload('jsonrpc must be "2.0"', 'jsonrpc', { endpoint });
  }
  if (
    !Object.prototype.hasOwnProperty.call(data, 'id') ||
    (typeof data.id !== 'string' && typeof data.id !== 'number' && data.id !== null)
  ) {
    throw invalidPayload('id must be a string, number, or null', 'id', { endpoint });
  }

  const hasResult = Object.prototype.hasOwnProperty.call(data, 'result');
  const hasError = Object.prototype.hasOwnProperty.call(data, 'error');
  if (hasResult === hasError) {
    throw invalidPayload('response must contain exactly one of result or error', 'envelope', {
      endpoint,
    });
  }
  if (hasError) {
    const error = data.error;
    if (!error || typeof error !== 'object' || Array.isArray(error)) {
      throw invalidPayload('error must be an object', 'error', { endpoint });
    }
    const errorData = error as Record<string, unknown>;
    if (typeof errorData.code !== 'number' || !Number.isInteger(errorData.code)) {
      throw invalidPayload('error.code must be an integer', 'error.code', { endpoint });
    }
    if (typeof errorData.message !== 'string') {
      throw invalidPayload('error.message must be a string', 'error.message', { endpoint });
    }
  }
  return data;
}

function assertEventsResult(
  data: Record<string, unknown>,
  endpoint: string,
): Record<string, unknown>[] | undefined {
  if (data.error !== undefined) return undefined;
  const result = data.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw invalidPayload('result must be an object', 'result', { endpoint });
  }
  const events = (result as Record<string, unknown>).events;
  if (!Array.isArray(events)) {
    throw invalidPayload('result.events must be an array', 'result.events', { endpoint });
  }
  return events as Record<string, unknown>[];
}

function rpcErrorMessage(data: Record<string, unknown>): string | undefined {
  if (!data.error || typeof data.error !== 'object' || Array.isArray(data.error)) return undefined;
  const message = (data.error as Record<string, unknown>).message;
  return typeof message === 'string' ? message : undefined;
}

function resultCursor(data: Record<string, unknown>): string | undefined {
  if (!data.result || typeof data.result !== 'object' || Array.isArray(data.result)) {
    return undefined;
  }
  const cursor = (data.result as Record<string, unknown>).cursor;
  return typeof cursor === 'string' ? cursor : undefined;
}

function assertEvent(event: unknown, endpoint: string): asserts event is Record<string, unknown> {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw invalidPayload('event must be an object', 'event', { endpoint });
  }
  const data = event as Record<string, unknown>;
  const eventId = data.id;
  const context = { endpoint, eventId };
  if (eventId !== undefined && typeof eventId !== 'string' && typeof eventId !== 'number') {
    throw invalidPayload('event id must be a string or number', 'id', context);
  }
  if (!Array.isArray(data.topic)) {
    throw invalidPayload('topic must be an array', 'topic', context);
  }
  if (!data.topic.every((topic) => typeof topic === 'string' && topic.length > 0)) {
    throw invalidPayload('topic entries must be non-empty strings', 'topic', context);
  }
  if (typeof data.value !== 'string' || data.value.length === 0) {
    throw invalidPayload('value must be a non-empty string', 'value', context);
  }
  if (!Number.isInteger(data.ledger) || (data.ledger as number) < 0) {
    throw invalidPayload('ledger must be a non-negative integer', 'ledger', context);
  }
}

export interface ChunkRange {
  startLedger: number;
  endLedger: number;
}

/**
 * Fetches announcements from a specific ledger range.
 * @internal
 */
async function* fetchAnnouncementsRange(
  sorobanUrl: string,
  announcerContract: string,
  filterGroups: SorobanEventFilter[][],
  startLedger: number,
  toLedger: number | undefined,
  seen: Set<string>,
): AsyncGenerator<{ announcement: Announcement; ledger: number }> {
  const singleFilterGroup = filterGroups.length === 1;

  for (const filters of filterGroups) {
    let hasMore = true;
    let groupCursor: string | undefined = undefined;

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

      const data = assertRpcEnvelope(await res.json(), sorobanUrl);
      const errorMessage = rpcErrorMessage(data);
      if (errorMessage) {
        const range = parseLedgerRange(errorMessage);
        if (range && !groupCursor && startLedger < range.oldest) {
          throw new RetentionExceededError(startLedger, range.oldest);
        }
        // If we get a range error and we aren't exceeding retention, just break for this filter
        break;
      }

      const events = assertEventsResult(data, sorobanUrl) ?? [];

      for (const event of events) {
        assertEvent(event, sorobanUrl);
        const ledger = eventLedger(event);
        if (toLedger !== undefined && ledger !== undefined && ledger >= toLedger) {
          hasMore = false;
          continue;
        }

        const dedupeKey = String(event.id ?? `${event.txHash}:${JSON.stringify(event.topic)}`);
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const ann = parseAnnouncementEvent(event, { endpoint: sorobanUrl });
        if (ann && ledger !== undefined) {
          yield { announcement: ann, ledger };
        }
      }

      if (!hasMore || events.length < 1000) {
        hasMore = false;
      } else {
        groupCursor = resultCursor(data);
        if (!groupCursor) hasMore = false;
      }
    }
  }
}

/**
 * Merges multiple async iterables in order based on a numeric key.
 * @internal
 */
export async function* mergeOrdered<T>(
  iterables: Array<AsyncIterable<{ item: T; key: number }>>,
): AsyncGenerator<T> {
  const iterators = iterables.map((it) => it[Symbol.asyncIterator]());
  const pending: Array<{ value: T; key: number; index: number }> = [];

  // Initialize: pull first item from each iterator
  for (let i = 0; i < iterators.length; i++) {
    const result = await iterators[i].next();
    if (!result.done) {
      pending.push({ value: result.value.item, key: result.value.key, index: i });
    }
  }

  while (pending.length > 0) {
    // Find the item with the smallest key
    pending.sort((a, b) => a.key - b.key || a.index - b.index);
    const [next, ...rest] = pending;

    yield next.value;

    // Pull the next item from the iterator that just yielded
    const result = await iterators[next.index].next();
    if (!result.done) {
      rest.push({ value: result.value.item, key: result.value.key, index: next.index });
    }

    pending.length = 0;
    pending.push(...rest);
  }
}

/**
 * Splits a ledger range into N contiguous chunks.
 * @internal
 */
export function splitRange(
  startLedger: number,
  endLedger: number,
  numChunks: number,
): ChunkRange[] {
  if (numChunks <= 1) {
    return [{ startLedger, endLedger }];
  }

  const totalLedgers = endLedger - startLedger;

  const chunks: ChunkRange[] = [];

  for (let i = 0; i < numChunks; i++) {
    const chunkStart = startLedger + Math.floor((i * totalLedgers) / numChunks);
    const chunkEnd = startLedger + Math.floor(((i + 1) * totalLedgers) / numChunks);
    if (chunkStart < chunkEnd) {
      chunks.push({ startLedger: chunkStart, endLedger: chunkEnd });
    }
  }

  return chunks;
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

  // Use parallel chunking for cold scans (no cursor) when parallelism > 1
  const parallelism = opts?.parallelism ?? 1;
  if (!opts?.cursor && parallelism > 1 && toLedger !== undefined) {
    const seen = new Set<string>();
    const chunks = splitRange(startLedger, toLedger, parallelism);

    const chunkIterables = chunks.map((chunk) => {
      return (async function* () {
        for await (const result of fetchAnnouncementsRange(
          sorobanUrl,
          announcerContract,
          filterGroups,
          chunk.startLedger,
          chunk.endLedger,
          seen,
        )) {
          yield { item: result.announcement, key: result.ledger };
        }
      })();
    });

    yield* mergeOrdered(chunkIterables);
    return;
  }

  // Sequential path (existing behavior for cursor or parallelism = 1)
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

      const data = assertRpcEnvelope(await res.json(), sorobanUrl);
      const errorMessage = rpcErrorMessage(data);
      if (errorMessage) {
        const range = parseLedgerRange(errorMessage);
        if (range && !groupCursor && startLedger < range.oldest) {
          throw new RetentionExceededError(startLedger, range.oldest);
        }
        // If we get a range error and we aren't exceeding retention, just break for this filter
        // (This matches develop's original behavior where it breaks and moves to the next filter)
        break;
      }

      const events = assertEventsResult(data, sorobanUrl) ?? [];

      for (const event of events) {
        assertEvent(event, sorobanUrl);
        const ledger = eventLedger(event);
        if (toLedger !== undefined && ledger !== undefined && ledger >= toLedger) {
          hasMore = false;
          continue;
        }

        const dedupeKey = String(event.id ?? `${event.txHash}:${JSON.stringify(event.topic)}`);
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const ann = parseAnnouncementEvent(event, { endpoint: sorobanUrl });
        if (ann) yield ann;
      }

      if (!hasMore || events.length < 1000) {
        hasMore = false;
      } else {
        groupCursor = resultCursor(data);
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

  const probeData = assertRpcEnvelope(await probeRes.json(), sorobanUrl);
  const errorMessage = rpcErrorMessage(probeData);
  if (errorMessage) {
    return parseLedgerRange(errorMessage) ?? {};
  }
  return {};
}

async function getLatestLedger(sorobanUrl: string): Promise<number | undefined> {
  const res = await fetch(sorobanUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }),
  });
  const data = assertRpcEnvelope(await res.json(), sorobanUrl);
  if (data.error !== undefined) return undefined;
  const result = data.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw invalidPayload('result must be an object', 'result', { endpoint: sorobanUrl });
  }
  const sequence = (result as Record<string, unknown>).sequence;
  if (!Number.isInteger(sequence) || (sequence as number) < 0) {
    throw invalidPayload('result.sequence must be a non-negative integer', 'result.sequence', {
      endpoint: sorobanUrl,
    });
  }
  return sequence as number;
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
export function parseAnnouncementEvent(
  event: Record<string, unknown>,
  context: AnnouncementParseContext = {},
): Announcement | null {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw invalidPayload('event must be an object', 'event', context);
  }
  const topics = event.topic;
  const parseContext = { ...context, eventId: context.eventId ?? event.id };
  if (!Array.isArray(topics)) throw invalidPayload('topic must be an array', 'topic', parseContext);
  if (topics.length !== 3 && topics.length !== 4) {
    throw invalidPayload('topic must contain exactly 3 or 4 entries', 'topic', parseContext);
  }
  if (!topics.every((topic) => typeof topic === 'string' && topic.length > 0)) {
    throw invalidPayload('topic entries must be non-empty strings', 'topic', parseContext);
  }
  if (typeof event.value !== 'string' || event.value.length === 0) {
    throw invalidPayload('value must be a non-empty string', 'value', parseContext);
  }

  try {
    const ann =
      topics.length === 3
        ? parseV1AnnouncementEvent(event, topics)
        : parseV2AnnouncementEvent(event, topics);
    if (!ann) return null;
    const memo = extractMemo(event as { memo_type?: string; memo?: string });
    return memo ? { ...ann, memo } : ann;
  } catch (error) {
    if (error instanceof AnnouncementParseError) throw error;
    throw invalidPayload('event fields could not be decoded', 'event', parseContext);
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
