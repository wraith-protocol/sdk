import type { Announcement } from './types';
import { SCHEME_ID } from './constants';
import { getDeployment } from './deployments';
import { parseSubgraphAnnouncementsPage } from './validation';
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
 * Options for {@link fetchAnnouncements} and {@link fetchAnnouncementsPage}.
 *
 * EVM announcements come from a Goldsky subgraph and paginate by `skip` offset. The `cursor` is
 * therefore the decimal skip offset of the next page, which is what makes a scan resumable.
 *
 * Each page is size-bounded and its records are validated before they are returned, so a
 * malformed or hostile subgraph response cannot reach address matching or key derivation.
 */
export interface EvmFetchAnnouncementsOptions extends AnnouncementPaginationOptions {
  /** Override the subgraph URL for this call. */
  subgraphUrl?: string;
}

/** Default and maximum subgraph page size. */
const DEFAULT_PAGE_SIZE = 1000;

interface ResolvedArgs {
  url: string;
  options: EvmFetchAnnouncementsOptions | undefined;
}

function resolveArgs(
  chain: string,
  subgraphUrlOrOptions?: string | EvmFetchAnnouncementsOptions,
  maybeOptions?: EvmFetchAnnouncementsOptions,
): ResolvedArgs {
  const options = typeof subgraphUrlOrOptions === 'string' ? maybeOptions : subgraphUrlOrOptions;
  const url =
    (typeof subgraphUrlOrOptions === 'string' ? subgraphUrlOrOptions : options?.subgraphUrl) ||
    getDeployment(chain).subgraphUrl;
  return { url, options };
}

/** Decodes the decimal skip cursor, rejecting anything this SDK did not produce. */
function parseCursor(chain: string, cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!/^(0|[1-9][0-9]*)$/.test(cursor)) {
    throw new AnnouncementCursorError({ chain, cursor, reason: 'malformed' });
  }
  const skip = Number(cursor);
  if (!Number.isSafeInteger(skip)) {
    throw new AnnouncementCursorError({ chain, cursor, reason: 'malformed' });
  }
  return skip;
}

async function fetchPage(
  chain: string,
  url: string,
  skip: number,
  pageSize: number,
  options: EvmFetchAnnouncementsOptions | undefined,
): Promise<AnnouncementPage<Announcement>> {
  const context: RPCResponseContext = { chain, operation: 'fetchAnnouncements' };
  const query = {
    query: `query($first: Int!, $skip: Int!) {
        announcements(first: $first, skip: $skip, where: { schemeId: "${SCHEME_ID}" }, orderBy: block_number, orderDirection: asc) {
          schemeId
          stealthAddress
          caller
          ephemeralPubKey
          metadata
        }
      }`,
    variables: { first: pageSize, skip },
  };

  const payload = await requestBoundedJson({
    chain,
    url,
    endpoint: url,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    },
    signal: options?.signal,
    timeouts: resolveAnnouncementTimeouts(options?.timeouts),
    retry: resolveAnnouncementRetry(options?.retry),
    readJson: (response) => readBoundedJson(response, context, url),
  });

  const { announcements, recordCount } = parseSubgraphAnnouncementsPage(payload, context);
  const hasMore = recordCount === pageSize;

  return {
    announcements,
    cursor: hasMore ? String(skip + recordCount) : undefined,
    hasMore,
  };
}

/**
 * Fetches stealth address announcements from the Goldsky subgraph for the specified EVM chain.
 *
 * Every call is bounded by `maxPages`, `maxItems`, a timeout and an optional `AbortSignal`;
 * transient HTTP failures are retried with backoff. When a budget is exhausted the fetch throws
 * `AnnouncementBudgetExceededError` with the announcements collected so far and a `cursor` that
 * can be passed to a later call to resume.
 *
 * @param chain The chain identifier (e.g., "horizen").
 * @param subgraphUrlOrOptions Optional subgraph URL override, or options.
 * @param maybeOptions Options when the second argument is a URL.
 * @returns Array of announcements.
 * @throws {RPCRequestError} If the subgraph returns a non-2xx status.
 * @throws {RPCResponseError} If a page is oversized, malformed, or contains an
 *   invalid announcement record.
 */
export async function fetchAnnouncements(
  chain: string,
  subgraphUrlOrOptions?: string | EvmFetchAnnouncementsOptions,
  maybeOptions?: EvmFetchAnnouncementsOptions,
): Promise<Announcement[]> {
  const { url, options } = resolveArgs(chain, subgraphUrlOrOptions, maybeOptions);
  const pageSize = resolvePageSize(options?.pageSize, DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const result = await collectAnnouncementPages<Announcement>(chain, options, (cursor, limit) =>
    fetchPage(chain, url, parseCursor(chain, cursor), Math.min(pageSize, limit), options),
  );
  return result.announcements;
}

/**
 * Fetches a single bounded page of announcements, returning the cursor needed to resume.
 *
 * Use this when you want to persist progress page by page; use {@link fetchAnnouncements} when
 * one bounded call should drain the stream.
 */
export async function fetchAnnouncementsPage(
  chain: string,
  subgraphUrlOrOptions?: string | EvmFetchAnnouncementsOptions,
  maybeOptions?: EvmFetchAnnouncementsOptions,
): Promise<AnnouncementFetchResult<Announcement>> {
  const { url, options } = resolveArgs(chain, subgraphUrlOrOptions, maybeOptions);
  const pageSize = resolvePageSize(options?.pageSize, DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const skip = parseCursor(chain, options?.cursor);
  const page = await fetchPage(chain, url, skip, pageSize, options);
  return {
    announcements: page.announcements,
    cursor: page.cursor,
    hasMore: page.hasMore,
    pages: 1,
  };
}
