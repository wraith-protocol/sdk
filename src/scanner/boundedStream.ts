import { ScanBudgetExceededError } from '../errors';

/**
 * Per-chain resource budget for a scanner source.
 *
 * Every field has a finite default; there is no unbounded mode, so a slow or
 * hostile provider cannot make a scan fetch or buffer without limit.
 */
export interface ChainRequestBudget {
  /**
   * Maximum number of pulls (pages / RPC requests) taken from a streaming
   * source. A stream that is not finished after this many pulls fails with
   * {@link ScanBudgetExceededError} instead of being truncated silently.
   *
   * Only counts pulls from `source` inputs; materialized arrays are not
   * requests. Defaults to 10 000.
   */
  maxRequests?: number;
  /**
   * Maximum number of source pulls that may be outstanding at once. This is the
   * per-chain in-flight bound; it never changes the global chain-concurrency
   * scheduler. Defaults to 2.
   */
  maxInFlightRequests?: number;
  /**
   * Maximum number of announcements held in memory while waiting to be
   * scanned. When the buffer is full the source is not pulled again until the
   * scanner drains it, which is the backpressure signal. Defaults to 256.
   */
  maxBufferedAnnouncements?: number;
}

/** Defaults applied when a caller does not override a field. */
export const DEFAULT_CHAIN_REQUEST_BUDGET = {
  maxRequests: 10_000,
  maxInFlightRequests: 2,
  maxBufferedAnnouncements: 256,
} as const;

/** A resolved budget with every limit filled in. */
export interface ResolvedChainRequestBudget {
  maxRequests: number;
  maxInFlightRequests: number;
  maxBufferedAnnouncements: number;
}

/**
 * Resolves a partial budget to finite limits.
 *
 * Rejects non-finite, zero or negative values: a budget of `0` would silently
 * stop all work, which is a configuration bug rather than a bound.
 */
export function resolveChainRequestBudget(budget?: ChainRequestBudget): ResolvedChainRequestBudget {
  return {
    maxRequests: positiveInteger(budget?.maxRequests, DEFAULT_CHAIN_REQUEST_BUDGET.maxRequests),
    maxInFlightRequests: positiveInteger(
      budget?.maxInFlightRequests,
      DEFAULT_CHAIN_REQUEST_BUDGET.maxInFlightRequests,
    ),
    maxBufferedAnnouncements: positiveInteger(
      budget?.maxBufferedAnnouncements,
      DEFAULT_CHAIN_REQUEST_BUDGET.maxBufferedAnnouncements,
    ),
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 1) {
    throw new RangeError(`announcement budget limit must be a positive integer (got ${value})`);
  }
  return Math.trunc(value);
}

/** Snapshot of a chain stream's accounting. */
export interface BoundedStreamStats {
  /** Announcements handed to the scanner so far. */
  itemsRead: number;
  /** Pulls issued against the source so far. */
  requests: number;
  /** Announcements currently buffered, never above `maxBufferedAnnouncements`. */
  buffered: number;
  /** Pulls outstanding right now, never above `maxInFlightRequests`. */
  inFlight: number;
  /** True once the source has signalled completion. */
  exhausted: boolean;
}

export interface BoundedStreamOptions {
  /** Chain id used in budget errors and progress events. */
  chain: string;
  /** Per-chain limits. Missing fields fall back to the defaults. */
  budget?: ChainRequestBudget;
  /** Cancels pending pulls, drains the buffer and releases the source. */
  signal?: AbortSignal;
  /**
   * Whether pulls count against `maxRequests`. Materialized arrays are locally
   * available, so they are consumed without a request budget.
   */
  countRequests?: boolean;
  /** Called after every consumed item and on completion. */
  onProgress?: (stats: BoundedStreamStats) => void;
}

interface Waiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface PendingPull<T> {
  id: number;
  settled: boolean;
  hasError: boolean;
  error?: unknown;
  result?: IteratorResult<T>;
}

/**
 * Wraps an async iterable in a bounded, prefetching stream.
 *
 * Guarantees, independent of source behaviour:
 * - at most `maxInFlightRequests` pulls are outstanding;
 * - at most `maxBufferedAnnouncements` values are buffered, counting the pulls
 *   that will land in the buffer, so prefetch cannot overshoot the bound;
 * - at most `maxRequests` pulls are issued and a source that needs more fails
 *   with {@link ScanBudgetExceededError};
 * - `close()` drains the buffer, releases values and calls the source's
 *   `return()` so the producer stops.
 *
 * The stream is single-consumer: `next()` calls are serialized by the scanner.
 */
export class BoundedAnnouncementStream<T> implements AsyncIterable<T>, AsyncIterator<T> {
  private readonly iterator: AsyncIterator<T>;
  private readonly maxRequests: number;
  private readonly maxInFlightRequests: number;
  private readonly maxBufferedAnnouncements: number;
  private readonly countRequests: boolean;
  private readonly chain: string;
  private readonly signal?: AbortSignal;
  private readonly onProgress?: (stats: BoundedStreamStats) => void;
  private readonly onAbort = (): void => {
    void this.close();
  };

  private readonly buffer: T[] = [];
  private readonly waiters: Waiter[] = [];
  private readonly slots: PendingPull<T>[] = [];
  private inFlight = 0;
  private requests = 0;
  private itemsRead = 0;
  private pullId = 0;
  private commitId = 0;
  private done = false;
  private closed = false;
  private failure: unknown = undefined;
  private pumping = false;
  private committing = false;

  constructor(source: AsyncIterable<T>, options: BoundedStreamOptions) {
    this.iterator = source[Symbol.asyncIterator]();
    this.chain = options.chain;
    const limits = resolveChainRequestBudget(options.budget);
    this.maxRequests = limits.maxRequests;
    this.maxInFlightRequests = limits.maxInFlightRequests;
    this.maxBufferedAnnouncements = limits.maxBufferedAnnouncements;
    this.countRequests = options.countRequests ?? false;
    this.onProgress = options.onProgress;
    this.signal = options.signal;

    if (this.signal) {
      if (this.signal.aborted) {
        void this.close();
        return;
      }
      this.signal.addEventListener('abort', this.onAbort, { once: true });
    }

    this.pump();
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this;
  }

  /** Current accounting snapshot. */
  get stats(): BoundedStreamStats {
    return {
      itemsRead: this.itemsRead,
      requests: this.requests,
      buffered: this.buffer.length,
      inFlight: this.inFlight,
      exhausted: this.done,
    };
  }

  async next(): Promise<IteratorResult<T>> {
    while (true) {
      if (this.failure !== undefined) throw this.failure;

      if (this.buffer.length > 0) {
        const value = this.buffer.shift() as T;
        this.itemsRead++;
        this.pump();
        this.onProgress?.(this.stats);
        return { done: false, value };
      }

      if (this.done) return { done: true, value: undefined };

      await new Promise<void>((resolve, reject) => {
        this.waiters.push({ resolve, reject });
      });
    }
  }

  async return(): Promise<IteratorResult<T>> {
    await this.close();
    return { done: true, value: undefined };
  }

  async throw(error?: unknown): Promise<IteratorResult<T>> {
    await this.close(error);
    throw error;
  }

  /**
   * Stops prefetching, drains the buffer and releases the source.
   *
   * Safe to call more than once. Pending `next()` calls reject with the abort
   * reason so a cancelled scan unwinds promptly.
   */
  async close(reason?: unknown): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.done = true;

    const error = this.failure !== undefined ? this.failure : (reason ?? this.abortReason());
    this.failure = error;

    // Drop buffered announcements before unwinding so cancellation releases
    // references immediately instead of waiting for GC.
    this.buffer.length = 0;
    this.slots.length = 0;
    this.inFlight = 0;
    this.waiters.splice(0).forEach((waiter) => waiter.reject(error));
    this.signal?.removeEventListener('abort', this.onAbort);

    try {
      await this.iterator.return?.();
    } catch {
      // A source that fails while closing must not mask the cancellation.
    }
  }

  private abortReason(): unknown {
    if (this.signal?.reason !== undefined) return this.signal.reason;
    return new DOMException('Scan cancelled', 'AbortError');
  }

  /**
   * Tops the buffer up to its bound. Called whenever a slot frees up, so the
   * producer stays suspended while the scanner is behind.
   */
  private pump(): void {
    if (this.pumping || this.closed || this.done) return;
    this.pumping = true;
    try {
      while (
        this.slots.length < this.maxInFlightRequests &&
        this.buffer.length + this.slots.length < this.maxBufferedAnnouncements &&
        (!this.countRequests || this.requests < this.maxRequests)
      ) {
        if (this.countRequests) this.requests++;
        this.pull();
      }
    } finally {
      this.pumping = false;
    }
    this.checkRequestBudget();
  }

  private pull(): void {
    const slot: PendingPull<T> = {
      id: this.pullId++,
      settled: false,
      hasError: false,
    };
    this.slots.push(slot);
    this.inFlight++;

    let result: Promise<IteratorResult<T>>;
    try {
      result = this.iterator.next();
    } catch (error) {
      this.inFlight--;
      this.settle(slot, { hasError: true, error });
      return;
    }
    result.then(
      (value) => {
        this.inFlight--;
        this.settle(slot, { hasError: false, result: value });
      },
      (error) => {
        this.inFlight--;
        this.settle(slot, { hasError: true, error });
      },
    );
  }

  private settle(
    slot: PendingPull<T>,
    outcome: Pick<PendingPull<T>, 'hasError' | 'error' | 'result'>,
  ): void {
    if (this.closed) return;
    slot.settled = true;
    slot.hasError = outcome.hasError;
    slot.error = outcome.error;
    slot.result = outcome.result;
    this.commit();
  }

  private commit(): void {
    if (this.committing || this.closed) return;
    this.committing = true;
    try {
      while (true) {
        const slot = this.slots[0];
        if (!slot?.settled || slot.id !== this.commitId) break;
        this.slots.shift();
        this.commitId++;

        if (slot.hasError) {
          this.fail(slot.error);
          return;
        }

        const result = slot.result as IteratorResult<T>;
        if (result.done) {
          this.done = true;
          this.waiters.splice(0).forEach((waiter) => waiter.resolve());
          this.onProgress?.(this.stats);
          return;
        }

        this.buffer.push(result.value);
        this.waiters.shift()?.resolve();
      }
    } finally {
      this.committing = false;
    }
    this.pump();
  }

  private fail(error: unknown): void {
    if (this.closed) return;
    this.failure = error;
    void this.close(error);
  }

  private checkRequestBudget(): void {
    if (!this.countRequests || this.closed || this.done) return;
    if (this.requests < this.maxRequests || this.slots.length > 0 || this.inFlight > 0) return;
    this.fail(
      new ScanBudgetExceededError(this.chain, 'requests', this.maxRequests, this.itemsRead),
    );
  }
}

/** Turns a materialized array into an async iterable without copying it. */
export async function* arraySource<T>(items: readonly T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}
