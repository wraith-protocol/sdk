import { getDeployment } from './deployments';
import type { StealthCell } from './types';
import { parseStealthCellPage } from './validation';
import { readBoundedJson, type RPCResponseContext } from '../rpcValidation';
import { AnnouncementCursorError } from '../../errors';
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
 * which is what makes a scan resumable. Queries all live cells using the stealth-lock code hash.
 * On CKB, cells ARE the announcements — the lock script args contain the ephemeral pubkey and
 * stealth pubkey hash.
 *
 * Each page is size-bounded and its cells are validated before use, so a malformed or hostile
 * indexer response cannot reach address matching or key derivation.
 *
 * @throws {RPCRequestError} If the indexer returns a non-2xx status.
 * @throws {RPCResponseError} If a page is oversized, malformed, or contains an invalid cell.
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

async function fetchPage(
  chain: string,
  url: string,
  cursor: string | undefined,
  pageSize: number,
  options: CkbFetchStealthCellsOptions | undefined,
): Promise<AnnouncementPage<StealthCell>> {
  const deployment = getDeployment(chain);
  const context: RPCResponseContext = { chain, operation: 'fetchStealthCells' };
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
    readJson: (response) => readBoundedJson(response, context, url),
  });

  const page = parseStealthCellPage(payload, context);
  const nextCursor = page.cursor ?? undefined;
  const hasMore = page.rawCount > 0 && nextCursor !== undefined;

  return {
    announcements: page.cells,
    cursor: nextCursor,
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
  const result = await collectAnnouncementPages<StealthCell>(chain, options, (cursor, limit) =>
    fetchPage(chain, url, parseCursor(chain, cursor), Math.min(pageSize, limit), options),
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
