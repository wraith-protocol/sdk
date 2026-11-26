/**
 * Multichain Scanner Pool
 *
 * Schedules one scan per configured chain under an outer chain-concurrency
 * limit, and underneath that gives each chain its own bounded streaming input:
 * per-chain request and in-flight budgets, a bounded announcement buffer with
 * backpressure, cancellation that drains queues, and progress accounting.
 *
 * Environment behaviour:
 * - Browser / Node / React Native: all use Promise-based concurrency.
 *   True thread-level parallelism via Web Workers / worker_threads is a
 *   future optimisation; the JS event loop already parallelises I/O-bound
 *   work and the crypto operations here are fast enough that worker overhead
 *   would dominate for typical announcement counts.
 *
 * Security note on key material:
 * - Private keys are passed as Uint8Array / hex strings within the same
 *   JS heap. structuredClone (used by postMessage) copies Uint8Array safely,
 *   but we deliberately keep everything in-process to avoid any serialisation
 *   risk until a hardened worker transport is implemented.
 */

import type {
  Announcement as EvmAnnouncement,
  MatchedAnnouncement as EvmMatchedAnnouncement,
  HexString,
} from './chains/evm/types';
import type {
  Announcement as StellarAnnouncement,
  MatchedAnnouncement as StellarMatchedAnnouncement,
} from './chains/stellar/types';
import type {
  Announcement as SolanaAnnouncement,
  MatchedAnnouncement as SolanaMatchedAnnouncement,
} from './chains/solana/types';
import type {
  StealthCell as CkbCell,
  MatchedStealthCell as CkbMatchedCell,
} from './chains/ckb/types';
import {
  BoundedAnnouncementStream,
  arraySource,
  type BoundedStreamStats,
  type ChainRequestBudget,
} from './scanner/boundedStream';

export type SupportedChain = 'evm' | 'stellar' | 'solana' | 'ckb';

/**
 * A chain scan input is either a materialized array or a streaming source, plus
 * the recipient key material. Providing both, or neither, is rejected.
 *
 * `budget` overrides the pool's per-chain budget for this scan only.
 */
export interface EvmScanInput {
  /** Materialized announcements. Provide this or `source`, not both. */
  announcements?: EvmAnnouncement[];
  /** Streaming announcements. Provide this or `announcements`, not both. */
  source?: AsyncIterable<EvmAnnouncement>;
  /** Per-scan override of the pool's budget for this chain. */
  budget?: ChainRequestBudget;
  viewingKey: HexString;
  spendingPubKey: HexString;
  spendingKey: HexString;
}

export interface StellarScanInput {
  announcements?: StellarAnnouncement[];
  source?: AsyncIterable<StellarAnnouncement>;
  budget?: ChainRequestBudget;
  viewingKey: Uint8Array;
  spendingPubKey: Uint8Array;
  spendingScalar: bigint;
}

export interface SolanaScanInput {
  announcements?: SolanaAnnouncement[];
  source?: AsyncIterable<SolanaAnnouncement>;
  budget?: ChainRequestBudget;
  viewingKey: Uint8Array;
  spendingPubKey: Uint8Array;
  spendingScalar: bigint;
}

export interface CkbScanInput {
  cells?: CkbCell[];
  source?: AsyncIterable<CkbCell>;
  budget?: ChainRequestBudget;
  viewingKey: HexString;
  spendingPubKey: HexString;
  spendingKey: HexString;
}

export interface ScanInput {
  evm?: EvmScanInput;
  stellar?: StellarScanInput;
  solana?: SolanaScanInput;
  ckb?: CkbScanInput;
}

export interface ScanResults {
  evm?: EvmMatchedAnnouncement[];
  stellar?: StellarMatchedAnnouncement[];
  solana?: SolanaMatchedAnnouncement[];
  ckb?: CkbMatchedCell[];
}

export interface ProgressEvent {
  chain: SupportedChain;
  /** Announcements handed to the chain scanner so far. */
  processed: number;
  /** Known input length, or `0` when the chain is a stream of unknown length. */
  total: number;
  /** Source pulls (pages / RPC requests) issued so far. */
  requests?: number;
  /** Announcements buffered at the time of the event, bounded by the budget. */
  buffered?: number;
  /** True when this chain was scanned from a stream instead of an array. */
  streaming?: boolean;
}

export interface MultichainScannerPoolOptions {
  /**
   * Which chains to include. Defaults to all four.
   * Only chains that also have a corresponding key in the `scanAll` input
   * will actually be scanned.
   */
  chains?: SupportedChain[];
  /**
   * Maximum number of chain scans to run concurrently.
   * Defaults to 4 (one per chain). Lower values throttle parallelism.
   *
   * This is the outer scheduler and is never replaced by per-chain budgets: a
   * slow chain holds only its own slot.
   */
  concurrency?: number;
  /**
   * When true (default), the first chain error rejects the whole scanAll call
   * and cancels the other chains. When false, all chains run to completion and
   * the first per-chain error is thrown afterwards.
   */
  failFast?: boolean;
  /**
   * Default per-chain request budget applied to every chain unless overridden
   * by `budgets` or by a scan input's own `budget`.
   */
  requestBudget?: ChainRequestBudget;
  /** Per-chain budget overrides, e.g. `{ solana: { maxInFlightRequests: 4 } }`. */
  budgets?: Partial<Record<SupportedChain, ChainRequestBudget>>;
}

interface ResolvedSource<T> {
  source: AsyncIterable<T>;
  total: number;
  streaming: boolean;
}

function abortReason(signal?: AbortSignal): unknown {
  if (signal?.reason !== undefined) return signal.reason;
  return new DOMException('Scan cancelled', 'AbortError');
}

/** Emit interval for mid-stream progress; the final event is always emitted. */
const PROGRESS_INTERVAL = 64;

/**
 * Picks the array or the stream from an input and validates the shape.
 *
 * Null inputs, dual inputs and non-iterable sources fail loudly rather than
 * being scanned as empty.
 */
function resolveSource<T>(
  chain: SupportedChain,
  kind: 'announcements' | 'cells',
  input: { announcements?: readonly T[]; source?: AsyncIterable<T> } | null | undefined,
  items: readonly T[] | undefined,
): ResolvedSource<T> {
  if (input === null || input === undefined) {
    throw new TypeError(`scan input for "${chain}" is required`);
  }

  const hasArray = Array.isArray(items);
  const hasSource = input.source !== undefined && input.source !== null;

  if (hasArray && hasSource) {
    throw new TypeError(
      `scan input for "${chain}" must provide either "${kind}" or "source", not both`,
    );
  }

  if (hasSource) {
    if (typeof (input.source as AsyncIterable<T>)[Symbol.asyncIterator] !== 'function') {
      throw new TypeError(`scan input for "${chain}" has a "source" that is not async iterable`);
    }
    return { source: input.source as AsyncIterable<T>, total: 0, streaming: true };
  }

  if (hasArray) {
    return { source: arraySource(items), total: items.length, streaming: false };
  }

  throw new TypeError(
    `scan input for "${chain}" requires a "${kind}" array or a "source" async iterable`,
  );
}

async function collect<T>(matches: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const match of matches) out.push(match);
  return out;
}

export class MultichainScannerPool {
  private readonly chains: SupportedChain[];
  private readonly concurrency: number;
  private readonly failFast: boolean;
  private readonly requestBudget: ChainRequestBudget;
  private readonly budgets: Partial<Record<SupportedChain, ChainRequestBudget>>;
  private readonly progressListeners = new Set<(event: ProgressEvent) => void>();

  constructor(options: MultichainScannerPoolOptions = {}) {
    this.chains = options.chains ?? (['evm', 'stellar', 'solana', 'ckb'] as SupportedChain[]);
    this.concurrency = Math.max(1, options.concurrency ?? 4);
    this.failFast = options.failFast ?? true;
    this.requestBudget = options.requestBudget ?? {};
    this.budgets = options.budgets ?? {};
  }

  on(event: 'progress', listener: (e: ProgressEvent) => void): this {
    if (event === 'progress') this.progressListeners.add(listener);
    return this;
  }

  off(event: 'progress', listener: (e: ProgressEvent) => void): this {
    if (event === 'progress') this.progressListeners.delete(listener);
    return this;
  }

  private emit(event: ProgressEvent): void {
    this.progressListeners.forEach((fn) => fn(event));
  }

  /**
   * Scan all configured chains in parallel.
   *
   * @param input   Per-chain scan parameters. Chains absent from this object
   *                are skipped even if listed in `options.chains`.
   * @param signal  Optional AbortSignal. Aborting cancels pending scans,
   *                drains every chain's buffer and rejects the returned
   *                promise with the signal's reason.
   */
  async scanAll(input: ScanInput, signal?: AbortSignal): Promise<ScanResults> {
    if (signal?.aborted) throw abortReason(signal);

    // Only scan chains that have input provided
    const activeChains = this.chains.filter((c) => input[c] !== undefined);
    if (activeChains.length === 0) return {};

    const results: ScanResults = {};

    // One controller per scanAll call so that a failure or cancellation under
    // the outer chain scheduler stops every chain's source promptly.
    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort(signal?.reason);
    signal?.addEventListener('abort', forwardAbort, { once: true });

    try {
      // Run up to `concurrency` chains at a time using a simple queue
      await this.runWithConcurrency(activeChains, this.concurrency, async (chain) => {
        if (controller.signal.aborted) throw abortReason(controller.signal);

        const chainInput = input[chain]!;
        const matched = await this.scanChain(chain, chainInput, controller.signal);

        // Type-safe result assignment
        (results as Record<string, unknown>)[chain] = matched;
      });
    } finally {
      signal?.removeEventListener('abort', forwardAbort);
      // Releasing here covers every exit: success, error and cancellation.
      // Streams drop their buffers and call the source's return().
      controller.abort(signal?.reason);
    }

    return results;
  }

  /**
   * Runs `tasks` with at most `limit` running concurrently.
   * Respects `failFast`: if true, the first rejection propagates immediately.
   * If false, all tasks run to completion before any error is thrown.
   */
  private async runWithConcurrency<T>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<void>,
  ): Promise<void> {
    if (this.failFast) {
      await this.runFailFast(items, limit, fn);
    } else {
      await this.runSettleAll(items, limit, fn);
    }
  }

  private async runFailFast<T>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<void>,
  ): Promise<void> {
    const queue = [...items];
    const active = new Set<Promise<void>>();

    const launch = (): Promise<void> | undefined => {
      if (queue.length === 0) return undefined;
      const item = queue.shift()!;
      const p: Promise<void> = fn(item).finally(() => active.delete(p));
      active.add(p);
      return p;
    };

    // Fill up to the concurrency limit
    while (active.size < limit && queue.length > 0) launch();

    // As each slot frees up, launch the next item
    while (active.size > 0) {
      await Promise.race(active);
      while (active.size < limit && queue.length > 0) launch();
    }
  }

  private async runSettleAll<T>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<void>,
  ): Promise<void> {
    const errors: unknown[] = [];
    await this.runFailFast(items, limit, async (item) => {
      try {
        await fn(item);
      } catch (err) {
        errors.push(err);
      }
    });
    if (errors.length > 0) throw errors[0];
  }

  /** Merges the global budget with the per-chain and per-scan overrides. */
  private budgetFor(chain: SupportedChain, override?: ChainRequestBudget): ChainRequestBudget {
    return { ...this.requestBudget, ...this.budgets[chain], ...override };
  }

  /**
   * Scans one chain from its array or stream, bounded by the chain's budget.
   *
   * The chain adapter consumes the bounded stream directly, so announcements
   * are scanned in small batches and buffered values never exceed the budget.
   */
  private async scanChain(
    chain: SupportedChain,
    input: EvmScanInput | StellarScanInput | SolanaScanInput | CkbScanInput,
    signal: AbortSignal,
  ): Promise<unknown[]> {
    if (signal.aborted) throw abortReason(signal);

    const source = this.resolveChainSource(chain, input);

    const stream = new BoundedAnnouncementStream(source.source, {
      chain,
      budget: this.budgetFor(chain, input.budget),
      signal,
      countRequests: source.streaming,
      onProgress: (stats) => this.emitBoundedProgress(chain, stats, source.total, source.streaming),
    });

    this.emit({
      chain,
      processed: 0,
      total: source.total,
      requests: 0,
      buffered: 0,
      streaming: source.streaming,
    });

    try {
      return await this.runAdapter(chain, stream, input);
    } finally {
      const stats = stream.stats;
      await stream.close();
      this.emit({
        chain,
        processed: stats.itemsRead,
        total: source.total,
        requests: stats.requests,
        buffered: 0,
        streaming: source.streaming,
      });
    }
  }

  /** Narrows each chain's input to its own item type before streaming it. */
  private resolveChainSource(
    chain: SupportedChain,
    input: EvmScanInput | StellarScanInput | SolanaScanInput | CkbScanInput,
  ): ResolvedSource<unknown> {
    switch (chain) {
      case 'evm': {
        const i = input as EvmScanInput;
        return resolveSource<EvmAnnouncement>(chain, 'announcements', i, i.announcements);
      }
      case 'stellar': {
        const i = input as StellarScanInput;
        return resolveSource<StellarAnnouncement>(chain, 'announcements', i, i.announcements);
      }
      case 'solana': {
        const i = input as SolanaScanInput;
        return resolveSource<SolanaAnnouncement>(chain, 'announcements', i, i.announcements);
      }
      case 'ckb': {
        const i = input as CkbScanInput;
        return resolveSource<CkbCell>(chain, 'cells', i, i.cells);
      }
      default:
        throw new Error(`Unsupported chain: ${chain}`);
    }
  }

  /** Throttled progress: every {@link PROGRESS_INTERVAL} items. */
  private emitBoundedProgress(
    chain: SupportedChain,
    stats: BoundedStreamStats,
    total: number,
    streaming: boolean,
  ): void {
    if (stats.itemsRead === 0 || stats.itemsRead % PROGRESS_INTERVAL !== 0) return;
    this.emit({
      chain,
      processed: stats.itemsRead,
      total,
      requests: stats.requests,
      buffered: stats.buffered,
      streaming,
    });
  }

  private async runAdapter(
    chain: SupportedChain,
    source: AsyncIterable<unknown>,
    input: EvmScanInput | StellarScanInput | SolanaScanInput | CkbScanInput,
  ): Promise<unknown[]> {
    switch (chain) {
      case 'evm': {
        const { adapter } = await import('./chains/evm/scan');
        const i = input as EvmScanInput;
        return collect(
          adapter.scan(source as AsyncIterable<EvmAnnouncement>, {
            viewingKey: i.viewingKey,
            spendingPubKey: i.spendingPubKey,
            spendingKey: i.spendingKey,
          }),
        );
      }
      case 'stellar': {
        const { adapter } = await import('./chains/stellar/scan');
        const i = input as StellarScanInput;
        return collect(
          adapter.scan(source as AsyncIterable<StellarAnnouncement>, {
            viewingKey: i.viewingKey,
            spendingPubKey: i.spendingPubKey,
            spendingScalar: i.spendingScalar,
          }),
        );
      }
      case 'solana': {
        const { adapter } = await import('./chains/solana/scan');
        const i = input as SolanaScanInput;
        return collect(
          adapter.scan(source as AsyncIterable<SolanaAnnouncement>, {
            viewingKey: i.viewingKey,
            spendingPubKey: i.spendingPubKey,
            spendingScalar: i.spendingScalar,
          }),
        );
      }
      case 'ckb': {
        const { adapter } = await import('./chains/ckb/scan');
        const i = input as CkbScanInput;
        return collect(
          adapter.scan(source as AsyncIterable<CkbCell>, {
            viewingKey: i.viewingKey,
            spendingPubKey: i.spendingPubKey,
            spendingKey: i.spendingKey,
          }),
        );
      }
      default:
        throw new Error(`Unsupported chain: ${chain}`);
    }
  }
}
