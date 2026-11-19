import { getDeployment } from './deployments';
import type { HexString, StealthCell } from './types';
import {
  AnnouncementCursorError,
  AnnouncementProviderError,
  AnnouncementResponseError,
} from '../../errors';
import {
  collectAnnouncementPages,
  requestBoundedJson,
  resolveAnnouncementRetry,
  resolveAnnouncementTimeouts,
  resolvePageSize,
  type AnnouncementFetchResult,
  type AnnouncementPage,
  type AnnouncementPaginationOptions,
} from '../announcementFetch';

/**
 * Options for {@link fetchStealthCells} and {@link fetchStealthCellsPage}.
 *
 * The CKB indexer pages with an opaque `last_cursor`; the `cursor` here is that value unchanged,
 * which is what makes a scan resumable.
 */
export interface CkbFetchStealthCellsOptions extends AnnouncementPaginationOptions {
  /** Override the CKB RPC URL for this call. */
  rpcUrl?: string;
}

/** Default and maximum indexer page size. */
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;

/** Hex cursor as returned by the CKB indexer. */
const HEX_CURSOR = /^0x[0-9a-fA-F]*$/;

interface ResolvedArgs {
  url: string;
  options: CkbFetchStealthCellsOptions | undefined;
}

function resolveArgs(
  chain: string,
  rpcUrlOrOptions?: string | CkbFetchStealthCellsOptions,
  maybeOptions?: CkbFetchStealthCellsOptions,
): ResolvedArgs {
  const options = typeof rpcUrlOrOptions === 'string' ? maybeOptions : rpcUrlOrOptions;
  const url =
    (typeof rpcUrlOrOptions === 'string' ? rpcUrlOrOptions : options?.rpcUrl) ||
    getDeployment(chain).rpcUrl;
  return { url, options };
}

/** Validates a resume cursor, rejecting anything this SDK did not receive from the indexer. */
function parseCursor(chain: string, cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined;
  if (!HEX_CURSOR.test(cursor)) {
    throw new AnnouncementCursorError({ chain, cursor, reason: 'malformed' });
  }
  return cursor;
}

interface IndexerResult {
  objects: Record<string, unknown>[];
  /** Cursor for the next page, or `undefined` when the indexer returned none. */
  lastCursor?: string;
}

function parseIndexerResponse(chain: string, endpoint: string, payload: unknown): IndexerResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AnnouncementResponseError({
      chain,
      endpoint,
      field: 'body',
      reason: 'expected an object',
    });
  }
  const body = payload as Record<string, unknown>;
  if (body.error !== undefined && body.error !== null) {
    const error = body.error;
    const reason =
      error &&
      typeof error === 'object' &&
      typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : JSON.stringify(error);
    throw new AnnouncementProviderError({ chain, endpoint, reason });
  }
  const result = body.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new AnnouncementResponseError({
      chain,
      endpoint,
      field: 'result',
      reason: 'expected an object',
    });
  }
  const objects = (result as Record<string, unknown>).objects;
  if (!Array.isArray(objects)) {
    throw new AnnouncementResponseError({
      chain,
      endpoint,
      field: 'result.objects',
      reason: 'expected an array',
    });
  }
  const lastCursor = (result as Record<string, unknown>).last_cursor;
  if (lastCursor !== undefined && lastCursor !== null && typeof lastCursor !== 'string') {
    throw new AnnouncementCursorError({
      chain,
      cursor: JSON.stringify(lastCursor),
      reason: 'malformed',
    });
  }
  return {
    objects: objects as Record<string, unknown>[],
    lastCursor: typeof lastCursor === 'string' ? lastCursor : undefined,
  };
}

function requireString(chain: string, endpoint: string, field: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AnnouncementResponseError({ chain, endpoint, field, reason: 'expected a string' });
  }
  return value;
}

function toStealthCell(
  chain: string,
  endpoint: string,
  raw: Record<string, unknown>,
  index: number,
): StealthCell | null {
  const field = `result.objects[${index}]`;
  const outPoint = raw.out_point;
  const output = raw.output;
  if (!outPoint || typeof outPoint !== 'object' || Array.isArray(outPoint)) {
    throw new AnnouncementResponseError({
      chain,
      endpoint,
      field: `${field}.out_point`,
      reason: 'expected an object',
    });
  }
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    throw new AnnouncementResponseError({
      chain,
      endpoint,
      field: `${field}.output`,
      reason: 'expected an object',
    });
  }
  const lock = (output as Record<string, unknown>).lock;
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) {
    throw new AnnouncementResponseError({
      chain,
      endpoint,
      field: `${field}.output.lock`,
      reason: 'expected an object',
    });
  }

  const txHash = requireString(
    chain,
    endpoint,
    `${field}.out_point.tx_hash`,
    (outPoint as Record<string, unknown>).tx_hash,
  );
  const indexHex = requireString(
    chain,
    endpoint,
    `${field}.out_point.index`,
    (outPoint as Record<string, unknown>).index,
  );
  const capacity = requireString(
    chain,
    endpoint,
    `${field}.output.capacity`,
    (output as Record<string, unknown>).capacity,
  );
  const args = requireString(
    chain,
    endpoint,
    `${field}.output.lock.args`,
    (lock as Record<string, unknown>).args,
  );

  // 0x + 53 bytes * 2 = 108 hex chars
  if (args.length !== 108) return null;

  return {
    txHash: txHash as HexString,
    index: parseInt(indexHex, 16),
    capacity: BigInt(capacity),
    lockArgs: args as HexString,
    ephemeralPubKey: `0x${args.slice(2, 68)}` as HexString,
    stealthPubKeyHash: `0x${args.slice(68)}` as HexString,
  };
}

async function fetchPage(
  chain: string,
  url: string,
  cursor: string | undefined,
  pageSize: number,
  options: CkbFetchStealthCellsOptions | undefined,
): Promise<AnnouncementPage<StealthCell>> {
  const deployment = getDeployment(chain);
  const payload = await requestBoundedJson({
    chain,
    url,
    endpoint: url,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 0,
        jsonrpc: '2.0',
        method: 'get_cells',
        params: [
          {
            script: {
              code_hash: deployment.contracts.stealthLockCodeHash,
              hash_type: 'data2',
              args: '0x',
            },
            script_type: 'lock',
          },
          'asc',
          `0x${pageSize.toString(16)}`,
          cursor ?? null,
        ],
      }),
    },
    signal: options?.signal,
    timeouts: resolveAnnouncementTimeouts(options?.timeouts),
    retry: resolveAnnouncementRetry(options?.retry),
  });

  const { objects, lastCursor } = parseIndexerResponse(chain, url, payload);
  const cells = objects
    .map((object, index) => toStealthCell(chain, url, object, index))
    .filter((cell): cell is StealthCell => cell !== null);

  const hasMore = objects.length > 0 && typeof lastCursor === 'string' && lastCursor.length > 0;

  return {
    announcements: cells,
    cursor: hasMore ? lastCursor : undefined,
    hasMore,
  };
}

/**
 * Fetches stealth cells from CKB via the indexer `get_cells` RPC.
 *
 * Queries all live cells using the stealth-lock code hash. On CKB, cells ARE the announcements —
 * the lock script args contain the ephemeral pubkey and stealth pubkey hash.
 *
 * Every call is bounded by `maxPages`, `maxItems`, `pageSize`, a timeout and an optional
 * `AbortSignal`; transient HTTP failures are retried with backoff. When a budget is exhausted
 * the fetch throws `AnnouncementBudgetExceededError` with the announcements collected so far and
 * a `cursor` that can be passed to a later call to resume.
 */
export async function fetchStealthCells(
  chain: string = 'ckb',
  rpcUrlOrOptions?: string | CkbFetchStealthCellsOptions,
  maybeOptions?: CkbFetchStealthCellsOptions,
): Promise<StealthCell[]> {
  const { url, options } = resolveArgs(chain, rpcUrlOrOptions, maybeOptions);
  const pageSize = resolvePageSize(options?.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const result = await collectAnnouncementPages<StealthCell>(chain, options, (cursor) =>
    fetchPage(chain, url, parseCursor(chain, cursor), pageSize, options),
  );
  return result.announcements;
}

/**
 * Fetches a single bounded page of stealth cells, returning the cursor needed to resume.
 */
export async function fetchStealthCellsPage(
  chain: string = 'ckb',
  rpcUrlOrOptions?: string | CkbFetchStealthCellsOptions,
  maybeOptions?: CkbFetchStealthCellsOptions,
): Promise<AnnouncementFetchResult<StealthCell>> {
  const { url, options } = resolveArgs(chain, rpcUrlOrOptions, maybeOptions);
  const pageSize = resolvePageSize(options?.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const page = await fetchPage(chain, url, parseCursor(chain, options?.cursor), pageSize, options);
  return {
    announcements: page.announcements,
    cursor: page.cursor,
    hasMore: page.hasMore,
    pages: 1,
  };
}
