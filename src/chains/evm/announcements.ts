import type { Announcement, HexString } from './types';
import { SCHEME_ID } from './constants';
import { getDeployment } from './deployments';
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
 * Options for {@link fetchAnnouncements} and {@link fetchAnnouncementsPage}.
 *
 * EVM announcements come from a Goldsky subgraph and paginate by `skip` offset. The `cursor` is
 * therefore the decimal skip offset of the next page, which is what makes a scan resumable.
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

function parseGraphqlResponse(
  chain: string,
  endpoint: string,
  payload: unknown,
): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AnnouncementResponseError({
      chain,
      endpoint,
      field: 'body',
      reason: 'expected an object',
    });
  }
  const body = payload as Record<string, unknown>;
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const reason = body.errors
      .map((error) =>
        error &&
        typeof error === 'object' &&
        typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : JSON.stringify(error),
      )
      .join('; ');
    throw new AnnouncementProviderError({ chain, endpoint, reason });
  }
  const data = body.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AnnouncementResponseError({
      chain,
      endpoint,
      field: 'data',
      reason: 'expected an object',
    });
  }
  const announcements = (data as Record<string, unknown>).announcements;
  if (!Array.isArray(announcements)) {
    throw new AnnouncementResponseError({
      chain,
      endpoint,
      field: 'data.announcements',
      reason: 'expected an array',
    });
  }
  return announcements as Record<string, unknown>[];
}

function toAnnouncement(
  chain: string,
  endpoint: string,
  raw: unknown,
  index: number,
): Announcement {
  const field = `data.announcements[${index}]`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AnnouncementResponseError({ chain, endpoint, field, reason: 'expected an object' });
  }
  const ann = raw as Record<string, unknown>;
  for (const key of ['stealthAddress', 'caller', 'ephemeralPubKey', 'metadata'] as const) {
    if (typeof ann[key] !== 'string') {
      throw new AnnouncementResponseError({
        chain,
        endpoint,
        field: `${field}.${key}`,
        reason: 'expected a string',
      });
    }
  }
  let schemeId: bigint;
  try {
    schemeId = BigInt(ann.schemeId as string);
  } catch {
    throw new AnnouncementResponseError({
      chain,
      endpoint,
      field: `${field}.schemeId`,
      reason: 'expected an integer',
    });
  }
  return {
    schemeId,
    stealthAddress: ann.stealthAddress as HexString,
    caller: ann.caller as HexString,
    ephemeralPubKey: ann.ephemeralPubKey as HexString,
    metadata: ann.metadata as HexString,
  };
}

async function fetchPage(
  chain: string,
  url: string,
  skip: number,
  pageSize: number,
  options: EvmFetchAnnouncementsOptions | undefined,
): Promise<AnnouncementPage<Announcement>> {
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
  });

  const raw = parseGraphqlResponse(chain, url, payload);
  const announcements = raw.map((entry, index) => toAnnouncement(chain, url, entry, index));
  const hasMore = raw.length === pageSize;

  return {
    announcements,
    cursor: hasMore ? String(skip + raw.length) : undefined,
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
 */
export async function fetchAnnouncements(
  chain: string,
  subgraphUrlOrOptions?: string | EvmFetchAnnouncementsOptions,
  maybeOptions?: EvmFetchAnnouncementsOptions,
): Promise<Announcement[]> {
  const { url, options } = resolveArgs(chain, subgraphUrlOrOptions, maybeOptions);
  const pageSize = resolvePageSize(options?.pageSize, DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const result = await collectAnnouncementPages<Announcement>(chain, options, async (cursor) =>
    fetchPage(chain, url, parseCursor(chain, cursor), pageSize, options),
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
