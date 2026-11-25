import { UnsupportedCapabilityError } from '../../base-error';
import type { Announcement } from './types';
import { getDeployment } from './deployments';
import { bytesToHex } from './utils';
import { AnnouncementCursorError, AnnouncementProviderError } from '../../errors';
import {
  collectAnnouncementPages,
  mapWithConcurrency,
  resolveAnnouncementRetry,
  resolveAnnouncementTimeouts,
  resolvePageSize,
  runBoundedOperation,
  type AnnouncementFetchResult,
  type AnnouncementPage,
  type AnnouncementPaginationOptions,
} from '../announcementFetch';

/**
 * Anchor event discriminator for AnnouncementEvent.
 * First 8 bytes of SHA-256("event:AnnouncementEvent").
 */
const ANNOUNCEMENT_EVENT_DISCRIMINATOR = [0xfa, 0xb0, 0x2a, 0xef, 0x3c, 0xad, 0x36, 0x88];

/** Default and maximum signature page size accepted by `getSignaturesForAddress`. */
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;

/** Default per-page transaction concurrency. */
const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 20;

/**
 * Options for {@link fetchAnnouncements} and {@link fetchAnnouncementsPage}.
 *
 * Solana has no event log endpoint, so the fetcher walks `getSignaturesForAddress` per program
 * and then reads each transaction. The cursor encodes the program being walked and the last
 * signature seen, which is the upstream-supported `before` paging position.
 */
export interface SolanaFetchAnnouncementsOptions extends AnnouncementPaginationOptions {
  /** Override the RPC URL for this call. */
  rpcUrl?: string;
  /**
   * Concurrent `getTransaction` calls per page.
   * @defaultValue 5
   */
  concurrency?: number;
}

interface ResolvedArgs {
  url: string;
  options: SolanaFetchAnnouncementsOptions | undefined;
}

interface SolanaCursorState {
  /** Index into the announcer/sender program list. */
  program: number;
  /** Signature to page before, i.e. the oldest signature already consumed. */
  before?: string;
}

const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

function resolveArgs(
  chain: string,
  rpcUrlOrOptions?: string | SolanaFetchAnnouncementsOptions,
  maybeOptions?: SolanaFetchAnnouncementsOptions,
): ResolvedArgs {
  const options = typeof rpcUrlOrOptions === 'string' ? maybeOptions : rpcUrlOrOptions;
  const url =
    (typeof rpcUrlOrOptions === 'string' ? rpcUrlOrOptions : options?.rpcUrl) ||
    getDeployment(chain).rpcUrl;
  return { url, options };
}

function encodeCursor(state: SolanaCursorState): string {
  return JSON.stringify({ v: 1, program: state.program, before: state.before ?? null });
}

/** Decodes the program/signature cursor, rejecting anything this SDK did not produce. */
function decodeCursor(chain: string, cursor: string | undefined): SolanaCursorState {
  if (cursor === undefined) return { program: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(cursor);
  } catch {
    throw new AnnouncementCursorError({ chain, cursor, reason: 'malformed' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AnnouncementCursorError({ chain, cursor, reason: 'malformed' });
  }
  const state = parsed as Record<string, unknown>;
  if (state.v !== 1 || (state.program !== 0 && state.program !== 1)) {
    throw new AnnouncementCursorError({ chain, cursor, reason: 'malformed' });
  }
  const before = state.before;
  if (before !== null && (typeof before !== 'string' || !BASE58_SIGNATURE.test(before))) {
    throw new AnnouncementCursorError({ chain, cursor, reason: 'malformed' });
  }
  return before === null ? { program: state.program } : { program: state.program, before };
}

/**
 * Solana RPC failures that are worth retrying: rate limits, timeouts and transient transport
 * errors. Everything else, such as a malformed request, is reported immediately.
 */
function isRetryableSolanaError(error: Error): boolean {
  return /(429|too many requests|rate.?limit|timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|50[0234])/i.test(
    error.message,
  );
}

/**
 * Fetches stealth address announcements from both the announcer and sender programs.
 * Queries each program's transaction history and parses AnnouncementEvent logs.
 *
 * Every call is bounded by `maxPages`, `maxItems`, `pageSize`, a timeout and an optional
 * `AbortSignal`; transport failures and rate limits are retried with backoff, and transactions
 * within a page are fetched with bounded concurrency. When a budget is exhausted the fetch
 * throws `AnnouncementBudgetExceededError` with the announcements collected so far and a
 * `cursor` that can be passed to a later call to resume.
 *
 * Requires @solana/web3.js as a peer dependency.
 *
 * @param chain The chain identifier (default: "solana").
 * @param rpcUrlOrOptions Optional RPC URL override, or options.
 * @param maybeOptions Options when the second argument is a URL.
 */
export async function fetchAnnouncements(
  chain: string = 'solana',
  rpcUrlOrOptions?: string | SolanaFetchAnnouncementsOptions,
  maybeOptions?: SolanaFetchAnnouncementsOptions,
): Promise<Announcement[]> {
  const { url, options } = resolveArgs(chain, rpcUrlOrOptions, maybeOptions);
  const network = await connect(chain, url);
  const pageSize = resolvePageSize(options?.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const concurrency = resolveConcurrency(options?.concurrency);
  const result = await collectAnnouncementPages<Announcement>(chain, options, (cursor) =>
    fetchPage(network, chain, url, cursor, pageSize, concurrency, options),
  );
  return result.announcements;
}

/**
 * Fetches a single bounded page of announcements, returning the cursor needed to resume.
 *
 * A page covers one `getSignaturesForAddress` window of one program; the cursor carries both,
 * so resuming continues exactly where the page stopped.
 */
export async function fetchAnnouncementsPage(
  chain: string = 'solana',
  rpcUrlOrOptions?: string | SolanaFetchAnnouncementsOptions,
  maybeOptions?: SolanaFetchAnnouncementsOptions,
): Promise<AnnouncementFetchResult<Announcement>> {
  const { url, options } = resolveArgs(chain, rpcUrlOrOptions, maybeOptions);
  const network = await connect(chain, url);
  const pageSize = resolvePageSize(options?.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const concurrency = resolveConcurrency(options?.concurrency);
  const page = await fetchPage(
    network,
    chain,
    url,
    options?.cursor,
    pageSize,
    concurrency,
    options,
  );
  return {
    announcements: page.announcements,
    cursor: page.cursor,
    hasMore: page.hasMore,
    pages: 1,
  };
}

interface SolanaNetwork {
  connection: import('@solana/web3.js').Connection;
  PublicKey: typeof import('@solana/web3.js').PublicKey;
  programs: string[];
}

async function connect(chain: string, url: string): Promise<SolanaNetwork> {
  const deployment = getDeployment(chain);
  let solanaWeb3: typeof import('@solana/web3.js');
  try {
    solanaWeb3 = await import('@solana/web3.js');
  } catch (cause) {
    throw new UnsupportedCapabilityError(
      "Cannot find package '@solana/web3.js' imported from @wraith-protocol/sdk/chains/solana.",
      {
        capability: '@solana/web3.js',
        remedy:
          "install or bundle the optional peer dependency '@solana/web3.js' (^1.95.0) before calling fetchAnnouncements(), or pass pre-fetched announcements to scanAnnouncements().",
        cause,
      },
    );
  }
  const { Connection, PublicKey } = solanaWeb3;
  return {
    connection: new Connection(url),
    PublicKey,
    programs: [deployment.contracts.announcer, deployment.contracts.sender],
  };
}

function resolveConcurrency(value: number | undefined): number {
  if (value === undefined) return DEFAULT_CONCURRENCY;
  if (!Number.isInteger(value) || value < 1 || value > MAX_CONCURRENCY) {
    throw new RangeError(
      `concurrency must be an integer between 1 and ${MAX_CONCURRENCY}, got ${String(value)}`,
    );
  }
  return value;
}

function boundedCall<T>(
  chain: string,
  endpoint: string,
  operation: string,
  options: SolanaFetchAnnouncementsOptions | undefined,
  call: () => Promise<T>,
): Promise<T> {
  const url = `${endpoint}#${operation}`;
  return runBoundedOperation<T>(
    {
      chain,
      endpoint,
      url,
      signal: options?.signal,
      timeouts: resolveAnnouncementTimeouts(options?.timeouts),
      retry: resolveAnnouncementRetry(options?.retry),
      isRetryable: isRetryableSolanaError,
      wrapError: (error) =>
        new AnnouncementProviderError({
          chain,
          endpoint,
          reason: `${operation} failed: ${error.message}`,
          cause: error,
        }),
    },
    call,
  );
}

async function fetchPage(
  network: SolanaNetwork,
  chain: string,
  endpoint: string,
  cursor: string | undefined,
  pageSize: number,
  concurrency: number,
  options: SolanaFetchAnnouncementsOptions | undefined,
): Promise<AnnouncementPage<Announcement>> {
  const state = decodeCursor(chain, cursor);
  const programId = network.programs[state.program];
  if (!programId) {
    throw new AnnouncementCursorError({
      chain,
      cursor: cursor ?? '',
      reason: 'malformed',
    });
  }

  const signatures = await boundedCall(chain, endpoint, 'getSignaturesForAddress', options, () =>
    network.connection.getSignaturesForAddress(new network.PublicKey(programId), {
      limit: pageSize,
      ...(state.before ? { before: state.before } : {}),
    }),
  );

  const announcements = (
    await mapWithConcurrency(signatures, concurrency, async (signature) => {
      const transaction = await boundedCall(chain, endpoint, 'getTransaction', options, () =>
        network.connection.getTransaction(signature.signature, {
          maxSupportedTransactionVersion: 0,
        }),
      );
      if (!transaction?.meta?.logMessages) return null;
      return parseAnnouncementFromLogs(transaction.meta.logMessages, network.PublicKey);
    })
  ).filter((announcement): announcement is Announcement => announcement !== null);

  const last = signatures[signatures.length - 1];
  let next: SolanaCursorState | undefined;
  if (signatures.length === pageSize && last) {
    next = { program: state.program, before: last.signature };
  } else if (state.program + 1 < network.programs.length) {
    next = { program: state.program + 1 };
  }

  return {
    announcements,
    cursor: next ? encodeCursor(next) : undefined,
    hasMore: next !== undefined,
  };
}

function parseAnnouncementFromLogs(
  logs: string[],
  PublicKey: typeof import('@solana/web3.js').PublicKey,
): Announcement | null {
  try {
    for (const log of logs) {
      if (!log.startsWith('Program data: ')) continue;

      const base64Data = log.replace('Program data: ', '');
      const bytes = base64ToBytes(base64Data);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

      // Check Anchor event discriminator (first 8 bytes)
      if (bytes.length < 8) continue;
      const matchesDisc = ANNOUNCEMENT_EVENT_DISCRIMINATOR.every((b, i) => b === bytes[i]);
      if (!matchesDisc) continue;

      let offset = 8;

      const schemeId = view.getUint32(offset, true);
      offset += 4;

      const stealthAddress = bytes.slice(offset, offset + 32);
      offset += 32;

      const caller = bytes.slice(offset, offset + 32);
      offset += 32;

      const ephemeralPubKey = bytes.slice(offset, offset + 32);
      offset += 32;

      const metadataLen = view.getUint32(offset, true);
      offset += 4;
      const metadata = bytes.slice(offset, offset + metadataLen);

      return {
        schemeId,
        stealthAddress: new PublicKey(stealthAddress).toBase58(),
        caller: new PublicKey(caller).toBase58(),
        ephemeralPubKey: bytesToHex(new Uint8Array(ephemeralPubKey)),
        metadata: bytesToHex(new Uint8Array(metadata)),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
