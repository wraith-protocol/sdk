import {
  AnnouncementBudgetExceededError,
  AnnouncementCursorError,
  AnnouncementResponseError,
  RPCAbortedError,
  RPCRequestError,
  RPCRetryExhaustedError,
  RPCTimeoutError,
  type RPCTimeoutPhase,
} from '../errors';

/**
 * Per-attempt timeouts for announcement fetches.
 *
 * `fetch()` has no separate hook for the TCP/TLS handshake, so `connectMs` covers everything up
 * to the response headers and `requestMs` bounds the whole attempt, reading the body included.
 * Solana RPC calls have no abortable transport; a timed-out call stops being waited for, though
 * the underlying request may still be in flight. `0` turns that timeout off.
 */
export interface AnnouncementRequestTimeouts {
  /**
   * Milliseconds to wait for the response headers (or the first RPC reply).
   * @defaultValue 10000
   */
  connectMs?: number;
  /**
   * Milliseconds allowed for the whole attempt, including reading the response body.
   * @defaultValue 30000
   */
  requestMs?: number;
}

/**
 * Retry policy for transient announcement-provider failures: HTTP 429/5xx, timeouts, and
 * provider-classified retryable RPC errors.
 *
 * Backoff is deterministic: `baseDelayMs * 2 ** attempt`, capped at `maxDelayMs`. A
 * `Retry-After` header on a retryable HTTP response overrides the computed delay, still capped.
 */
export interface AnnouncementRetryPolicy {
  /**
   * Retries after the first attempt.
   * @defaultValue 2
   */
  maxRetries?: number;
  /**
   * Delay before the first retry, doubling on each subsequent retry.
   * @defaultValue 250
   */
  baseDelayMs?: number;
  /**
   * Upper bound on a single backoff delay.
   * @defaultValue 10000
   */
  maxDelayMs?: number;
  /**
   * HTTP statuses treated as transient.
   * @defaultValue [429, 500, 502, 503, 504]
   */
  retryableStatuses?: number[];
}

/**
 * Bounds shared by every announcement fetcher, whichever chain's pagination model it uses.
 * Every bound has a finite default, so no fetch loop can run or accumulate without one.
 */
export interface AnnouncementFetchOptions {
  /**
   * Cancels the fetch. An already-aborted signal rejects before any request is sent; aborting
   * mid-fetch rejects with {@link RPCAbortedError} and stops backoff sleeps.
   */
  signal?: AbortSignal;
  /** Per-attempt timeouts. */
  timeouts?: AnnouncementRequestTimeouts;
  /** Retry/backoff policy for transient failures. */
  retry?: AnnouncementRetryPolicy;
  /**
   * Maximum provider pages fetched by one call.
   * @defaultValue 100
   */
  maxPages?: number;
  /**
   * Maximum announcements accumulated by one call.
   * @defaultValue 10000
   */
  maxItems?: number;
}

/** Options for a resumable announcement fetch. */
export interface AnnouncementPaginationOptions extends AnnouncementFetchOptions {
  /**
   * Cursor returned by a previous call. Its encoding is chain-specific and opaque to callers;
   * passing a cursor this SDK did not produce throws {@link AnnouncementCursorError}.
   */
  cursor?: string;
  /**
   * Items requested per provider page. Bounded by what the provider accepts; defaults are
   * chain-specific.
   */
  pageSize?: number;
}

/**
 * One page of announcements, plus the state needed to resume after it.
 *
 * This shape is shared by all three announcement chains, but the cursor encoding is not: it is
 * EVM skip offset, Solana program/signature state or CKB's opaque indexer cursor respectively.
 */
export interface AnnouncementPage<T> {
  /** Announcements decoded from this page. */
  announcements: T[];
  /** Cursor to resume from after this page, or `undefined` when the stream is finished. */
  cursor?: string;
  /** Whether the provider reported more pages after this one. */
  hasMore: boolean;
}

/** Result of a bounded announcement fetch. */
export interface AnnouncementFetchResult<T> {
  /** Everything fetched, in provider order. */
  announcements: T[];
  /** Cursor to resume from; `undefined` when the stream was consumed to the end. */
  cursor?: string;
  /** Whether more pages remain upstream. `false` when the fetch finished within its budget. */
  hasMore: boolean;
  /** Number of provider pages fetched. */
  pages: number;
}

/** Resolved timeout pair. */
export interface ResolvedAnnouncementTimeouts {
  connectMs: number;
  requestMs: number;
}

/** Resolved retry policy. */
export interface ResolvedAnnouncementRetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: number[];
}

/** Resolved budgets. */
export interface ResolvedAnnouncementBounds {
  maxPages: number;
  maxItems: number;
}

/** Largest delay `setTimeout` honours; anything bigger overflows and fires at once. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Default page and item budgets. */
export const DEFAULT_MAX_PAGES = 100;
export const DEFAULT_MAX_ITEMS = 10_000;

const DEFAULT_TIMEOUTS: ResolvedAnnouncementTimeouts = { connectMs: 10_000, requestMs: 30_000 };

const DEFAULT_RETRY: ResolvedAnnouncementRetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 250,
  maxDelayMs: 10_000,
  retryableStatuses: [429, 500, 502, 503, 504],
};

function assertInteger(name: string, value: number | undefined, min: number, max: number): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(
      `${name} must be an integer between ${min} and ${max}, got ${String(value)}`,
    );
  }
}

/**
 * Merges caller bounds over the defaults and validates them. Throws `RangeError` for a bound that
 * is not an integer in range, so a bad value fails before any request is sent.
 */
export function resolveAnnouncementBounds(
  options?: AnnouncementFetchOptions,
): ResolvedAnnouncementBounds {
  const maxPages = options?.maxPages ?? DEFAULT_MAX_PAGES;
  const maxItems = options?.maxItems ?? DEFAULT_MAX_ITEMS;
  assertInteger('maxPages', maxPages, 1, 100_000);
  assertInteger('maxItems', maxItems, 1, 10_000_000);
  return { maxPages, maxItems };
}

/**
 * Resolves and validates per-attempt timeouts over the defaults.
 */
export function resolveAnnouncementTimeouts(
  options?: AnnouncementRequestTimeouts,
): ResolvedAnnouncementTimeouts {
  const resolved = { ...DEFAULT_TIMEOUTS };
  for (const key of ['connectMs', 'requestMs'] as const) {
    const value = options?.[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !(value >= 0 && value <= MAX_TIMEOUT_MS)) {
      throw new RangeError(
        `timeouts.${key} must be between 0 and ${MAX_TIMEOUT_MS} milliseconds, got ${String(value)}`,
      );
    }
    resolved[key] = value;
  }
  return resolved;
}

/**
 * Resolves and validates the retry policy over the defaults.
 */
export function resolveAnnouncementRetry(
  options?: AnnouncementRetryPolicy,
): ResolvedAnnouncementRetryPolicy {
  const maxRetries = options?.maxRetries ?? DEFAULT_RETRY.maxRetries;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs;
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs;
  assertInteger('retry.maxRetries', maxRetries, 0, 20);
  if (typeof baseDelayMs !== 'number' || !(baseDelayMs >= 0 && baseDelayMs <= MAX_TIMEOUT_MS)) {
    throw new RangeError(
      `retry.baseDelayMs must be between 0 and ${MAX_TIMEOUT_MS} milliseconds, got ${String(baseDelayMs)}`,
    );
  }
  if (typeof maxDelayMs !== 'number' || !(maxDelayMs >= 0 && maxDelayMs <= MAX_TIMEOUT_MS)) {
    throw new RangeError(
      `retry.maxDelayMs must be between 0 and ${MAX_TIMEOUT_MS} milliseconds, got ${String(maxDelayMs)}`,
    );
  }
  const retryableStatuses = options?.retryableStatuses ?? DEFAULT_RETRY.retryableStatuses;
  if (
    !Array.isArray(retryableStatuses) ||
    !retryableStatuses.every((status) => Number.isInteger(status) && status >= 100 && status <= 599)
  ) {
    throw new RangeError('retry.retryableStatuses must be an array of HTTP status codes');
  }
  return { maxRetries, baseDelayMs, maxDelayMs, retryableStatuses: [...retryableStatuses] };
}

/**
 * Resolves and validates a chain's page size.
 */
export function resolvePageSize(
  value: number | undefined,
  defaultSize: number,
  maxSize: number,
): number {
  assertInteger('pageSize', value, 1, maxSize);
  return value ?? defaultSize;
}

/** Calls the current global `fetch`, so it is looked up per request and called unbound. */
const globalFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

/** Where an attempt was sent, reported on the timeout error if it expires. */
interface AttemptTarget {
  url: string;
  endpoint: string;
  attempt: number;
}

/**
 * The deadline for one attempt. It owns the `AbortSignal` passed to `fetch()`, aborts it when a
 * timeout fires, and races the work against the deadline, so an implementation that ignores the
 * signal still cannot hang the attempt. Must be disposed once the attempt settles.
 */
class AttemptDeadline {
  private readonly controller =
    typeof AbortController === 'function' ? new AbortController() : undefined;
  private readonly expiry: Promise<never>;
  private rejectExpiry!: (error: Error) => void;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private requestTimer: ReturnType<typeof setTimeout> | undefined;
  private failure: Error | undefined;

  constructor(
    timeouts: ResolvedAnnouncementTimeouts,
    private readonly target: AttemptTarget,
  ) {
    this.expiry = new Promise<never>((_, reject) => {
      this.rejectExpiry = reject;
    });
    // The expiry can reject while nothing is racing it; that must not be an unhandled rejection.
    this.expiry.catch(() => undefined);

    const { connectMs, requestMs } = timeouts;
    if (connectMs > 0) {
      this.connectTimer = setTimeout(() => this.expire('connect', connectMs), connectMs);
    }
    if (requestMs > 0) {
      this.requestTimer = setTimeout(() => this.expire('request', requestMs), requestMs);
    }
  }

  /** Calls `fetchImpl` with this attempt's abort signal and resolves once the headers arrive. */
  async send(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
    const signal = this.controller?.signal;
    const response = await this.watch(fetchImpl(url, signal ? { ...init, signal } : init));
    clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
    return response;
  }

  /** Waits for any work, such as a body read or an RPC call, within the request timeout. */
  watch<T>(work: Promise<T>): Promise<T> {
    return this.race(work);
  }

  /**
   * Ends the attempt early with `error`, for example when the caller's `AbortSignal` fires.
   * Does nothing once the attempt has already failed.
   */
  abort(error: Error): void {
    if (this.failure) return;
    this.fail(error);
  }

  /** Clears the timers. Safe to call more than once. */
  dispose(): void {
    clearTimeout(this.connectTimer);
    clearTimeout(this.requestTimer);
    this.connectTimer = undefined;
    this.requestTimer = undefined;
  }

  private async race<T>(work: Promise<T>): Promise<T> {
    try {
      return await Promise.race([work, this.expiry]);
    } catch (err) {
      // An aborted fetch rejects with whatever its implementation picks, usually a DOMException
      // named `AbortError`. Report the timeout or caller abort that caused it instead.
      throw this.failure ?? err;
    }
  }

  private expire(phase: RPCTimeoutPhase, timeoutMs: number): void {
    if (this.failure) return;
    this.fail(
      new RPCTimeoutError({
        ...this.target,
        phase,
        timeoutMs,
      }),
    );
  }

  private fail(error: Error): void {
    this.dispose();
    this.failure = error;
    this.rejectExpiry(error);
    this.controller?.abort(error);
  }
}

/** Parses a `Retry-After` header into milliseconds, or `null` when absent/unparseable. */
function parseRetryAfter(response: Response): number | null {
  const headers = response.headers;
  const value = typeof headers?.get === 'function' ? headers.get('Retry-After') : null;
  if (!value) return null;
  const seconds = parseInt(value, 10);
  if (!Number.isNaN(seconds) && seconds >= 0) return seconds * 1000;
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return Math.max(0, parsed - Date.now());
  return null;
}

/** Deterministic exponential backoff, capped, honouring `Retry-After` for HTTP responses. */
function backoffDelay(
  attempt: number,
  policy: ResolvedAnnouncementRetryPolicy,
  response?: Response,
): number {
  if (response) {
    const retryAfter = parseRetryAfter(response);
    if (retryAfter !== null) return Math.min(retryAfter, policy.maxDelayMs);
  }
  return Math.min(policy.baseDelayMs * 2 ** attempt, policy.maxDelayMs);
}

/** Sleeps for `ms`, rejecting with {@link RPCAbortedError} if the caller aborts meanwhile. */
async function sleep(ms: number, signal: AbortSignal | undefined, url: string): Promise<void> {
  if (signal?.aborted) throw new RPCAbortedError(url, { cause: signal.reason });
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup();
      reject(new RPCAbortedError(url, { cause: signal?.reason }));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort);
  });
}

/** Reads an error response's body for the typed error, never failing the error path itself. */
async function readBody(deadline: AttemptDeadline, response: Response): Promise<string> {
  if (typeof response.text !== 'function') return '';
  try {
    const text = await deadline.watch(response.text());
    try {
      return JSON.stringify(JSON.parse(text));
    } catch {
      return text;
    }
  } catch {
    return '';
  }
}

/** One bounded JSON request: timeout, abort, retry/backoff and typed transport errors. */
export interface BoundedJsonRequest {
  /** Chain name reported on typed errors. */
  chain: string;
  /** Full request URL. */
  url: string;
  /** Base endpoint reported on typed errors. */
  endpoint: string;
  /** Request options. The abort signal is set by the helper. */
  init?: RequestInit;
  /** Caller's cancellation signal. */
  signal?: AbortSignal;
  /** Resolved timeouts. */
  timeouts: ResolvedAnnouncementTimeouts;
  /** Resolved retry policy. */
  retry: ResolvedAnnouncementRetryPolicy;
}

/**
 * Sends one JSON request, retrying transient failures, and resolves with the decoded body.
 *
 * Rejects with `RPCAbortedError` on caller cancellation, `RPCTimeoutError` when a timeout fires
 * and retries are disabled, `RPCRetryExhaustedError` when every attempt fails transiently,
 * `RPCRequestError` for a non-retryable status, and `AnnouncementResponseError` for a 2xx body
 * that is not JSON.
 */
export async function requestBoundedJson(request: BoundedJsonRequest): Promise<unknown> {
  const { chain, url, endpoint, init = {}, signal, timeouts, retry } = request;
  if (signal?.aborted) throw new RPCAbortedError(url, { cause: signal.reason });

  const maxAttempts = retry.maxRetries + 1;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const deadline = new AttemptDeadline(timeouts, { url, endpoint, attempt: attempt + 1 });
    const onAbort = (): void => deadline.abort(new RPCAbortedError(url, { cause: signal?.reason }));
    signal?.addEventListener('abort', onAbort);

    try {
      const response = await deadline.send(globalFetch, url, init);

      if (!response.ok) {
        const body = await readBody(deadline, response);
        const failure = new RPCRequestError(url, response.status, body);
        if (!retry.retryableStatuses.includes(response.status)) throw failure;

        if (attempt + 1 < maxAttempts) {
          lastError = failure;
          await sleep(backoffDelay(attempt, retry, response), signal, url);
          continue;
        }
        if (maxAttempts > 1) {
          throw new RPCRetryExhaustedError(url, maxAttempts, `HTTP ${response.status}`, {
            cause: failure,
          });
        }
        throw failure;
      }

      try {
        return await deadline.watch(response.json());
      } catch (err) {
        if (err instanceof SyntaxError) {
          throw new AnnouncementResponseError({
            chain,
            endpoint,
            field: 'body',
            reason: 'not valid JSON',
          });
        }
        throw err;
      }
    } catch (err) {
      if (err instanceof RPCAbortedError || err instanceof AnnouncementResponseError) throw err;
      if (err instanceof RPCRequestError || err instanceof RPCRetryExhaustedError) throw err;

      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt + 1 < maxAttempts) {
        await sleep(backoffDelay(attempt, retry), signal, url);
        continue;
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      deadline.dispose();
    }
  }

  if (maxAttempts === 1 && lastError) throw lastError;
  throw new RPCRetryExhaustedError(url, maxAttempts, lastError?.message, { cause: lastError });
}

/** Options for a bounded non-HTTP operation, such as a Solana RPC call. */
export interface BoundedOperationOptions {
  /** Chain name reported on typed errors. */
  chain: string;
  /** Base endpoint reported on typed errors. */
  endpoint: string;
  /** Logical request URL reported on timeout/retry errors. */
  url: string;
  /** Caller's cancellation signal. */
  signal?: AbortSignal;
  /** Resolved timeouts. */
  timeouts: ResolvedAnnouncementTimeouts;
  /** Resolved retry policy. */
  retry: ResolvedAnnouncementRetryPolicy;
  /** Classifies a provider error as transient. Timeouts always count as transient. */
  isRetryable?: (error: Error) => boolean;
  /** Converts a non-retryable provider error into a typed error before it is thrown. */
  wrapError?: (error: Error) => Error;
}

/**
 * Runs one operation with a timeout, caller cancellation and retry/backoff. Used where the
 * transport cannot take an `AbortSignal` (Solana's web3.js connection), so the caller stops
 * waiting on a timed-out call even though the underlying request may still be in flight.
 */
export async function runBoundedOperation<T>(
  options: BoundedOperationOptions,
  operation: () => Promise<T>,
): Promise<T> {
  const { url, endpoint, signal, retry } = options;
  if (signal?.aborted) throw new RPCAbortedError(url, { cause: signal.reason });

  const maxAttempts = retry.maxRetries + 1;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const deadline = new AttemptDeadline(options.timeouts, { url, endpoint, attempt: attempt + 1 });
    const onAbort = (): void => deadline.abort(new RPCAbortedError(url, { cause: signal?.reason }));
    signal?.addEventListener('abort', onAbort);

    try {
      return await deadline.watch(operation());
    } catch (err) {
      if (err instanceof RPCAbortedError) throw err;
      const cause = err instanceof Error ? err : new Error(String(err));
      lastError = cause;
      const retryable = cause instanceof RPCTimeoutError || (options.isRetryable?.(cause) ?? false);
      if (!retryable) {
        throw options.wrapError ? options.wrapError(cause) : cause;
      }
      if (attempt + 1 < maxAttempts) {
        await sleep(backoffDelay(attempt, retry), signal, url);
        continue;
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      deadline.dispose();
    }
  }

  if (maxAttempts === 1 && lastError) throw lastError;
  throw new RPCRetryExhaustedError(url, maxAttempts, lastError?.message, { cause: lastError });
}

/**
 * Maps `items` through `mapper` with at most `concurrency` calls in flight, preserving order.
 * `concurrency` is validated by the caller; every worker runs until the list is drained.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Collects pages until the stream ends or a budget is exhausted. Enforces `maxPages`,
 * `maxItems`, cursor repetition and missing-cursor handling in one place, so every chain's
 * fetcher bounds the same way even though each encodes its cursor differently.
 *
 * Page requests are capped at the remaining item budget, so exhaustion never discards the
 * unconsumed suffix of an oversized page. On exhaustion it throws
 * {@link AnnouncementBudgetExceededError} with the announcements collected so far and a cursor
 * that resumes at the next unconsumed record.
 */
export async function collectAnnouncementPages<T>(
  chain: string,
  options: AnnouncementPaginationOptions | undefined,
  fetchPage: (cursor: string | undefined, limit: number) => Promise<AnnouncementPage<T>>,
): Promise<AnnouncementFetchResult<T>> {
  const { maxPages, maxItems } = resolveAnnouncementBounds(options);
  const signal = options?.signal;
  const announcements: T[] = [];
  const seenCursors = new Set<string>();
  let cursor = options?.cursor;
  let pages = 0;

  while (true) {
    if (pages >= maxPages) {
      throw new AnnouncementBudgetExceededError({
        chain,
        budget: 'pages',
        limit: maxPages,
        fetched: announcements.length,
        cursor,
        partial: [...announcements],
      });
    }
    if (signal?.aborted) throw new RPCAbortedError(chain, { cause: signal.reason });

    const remaining = maxItems - announcements.length;
    if (remaining <= 0) {
      throw new AnnouncementBudgetExceededError({
        chain,
        budget: 'items',
        limit: maxItems,
        fetched: announcements.length,
        cursor,
        partial: [...announcements],
      });
    }

    const page = await fetchPage(cursor, remaining);
    pages++;

    if (page.announcements.length > remaining) {
      announcements.push(...page.announcements.slice(0, remaining));
      throw new AnnouncementBudgetExceededError({
        chain,
        budget: 'items',
        limit: maxItems,
        fetched: announcements.length,
        cursor,
        partial: [...announcements],
      });
    }
    announcements.push(...page.announcements);

    if (!page.hasMore) {
      return { announcements, cursor: undefined, hasMore: false, pages };
    }

    const nextCursor = page.cursor;
    if (!nextCursor) {
      throw new AnnouncementCursorError({
        chain,
        cursor: cursor ?? '',
        reason: 'missing',
      });
    }
    if (nextCursor === cursor || seenCursors.has(nextCursor)) {
      throw new AnnouncementCursorError({ chain, cursor: nextCursor, reason: 'repeated' });
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;

    if (announcements.length >= maxItems) {
      throw new AnnouncementBudgetExceededError({
        chain,
        budget: 'items',
        limit: maxItems,
        fetched: announcements.length,
        cursor,
        partial: [...announcements],
      });
    }
  }
}
