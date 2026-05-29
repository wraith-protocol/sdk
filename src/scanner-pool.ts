/**
 * Multichain Scanner Pool
 *
 * Fans out scanning across multiple blockchains in parallel using Promise.all.
 * Each chain scan runs concurrently — no chain waits for another.
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

export type SupportedChain = 'evm' | 'stellar' | 'solana' | 'ckb';

export interface EvmScanInput {
  announcements: EvmAnnouncement[];
  viewingKey: HexString;
  spendingPubKey: HexString;
  spendingKey: HexString;
}

export interface StellarScanInput {
  announcements: StellarAnnouncement[];
  viewingKey: Uint8Array;
  spendingPubKey: Uint8Array;
  spendingScalar: bigint;
}

export interface SolanaScanInput {
  announcements: SolanaAnnouncement[];
  viewingKey: Uint8Array;
  spendingPubKey: Uint8Array;
  spendingScalar: bigint;
}

export interface CkbScanInput {
  cells: CkbCell[];
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
  processed: number;
  total: number;
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
   */
  concurrency?: number;
  /**
   * When true (default), the first chain error rejects the whole scanAll call.
   * When false, all chains run to completion and per-chain errors are thrown
   * individually (currently surfaces as a rejection after all settle).
   */
  failFast?: boolean;
}

export class MultichainScannerPool {
  private readonly chains: SupportedChain[];
  private readonly concurrency: number;
  private readonly failFast: boolean;
  private readonly progressListeners = new Set<(event: ProgressEvent) => void>();

  constructor(options: MultichainScannerPoolOptions = {}) {
    this.chains = options.chains ?? (['evm', 'stellar', 'solana', 'ckb'] as SupportedChain[]);
    this.concurrency = Math.max(1, options.concurrency ?? 4);
    this.failFast = options.failFast ?? true;
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
   * @param signal  Optional AbortSignal. Aborting cancels pending scans and
   *                rejects the returned promise.
   */
  async scanAll(input: ScanInput, signal?: AbortSignal): Promise<ScanResults> {
    if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');

    // Only scan chains that have input provided
    const activeChains = this.chains.filter((c) => input[c] !== undefined);
    if (activeChains.length === 0) return {};

    const results: ScanResults = {};

    // Run up to `concurrency` chains at a time using a simple queue
    await this.runWithConcurrency(activeChains, this.concurrency, async (chain) => {
      if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');

      const chainInput = input[chain]!;
      const matched = await this.scanChain(chain, chainInput, signal);

      // Type-safe result assignment
      (results as Record<string, unknown>)[chain] = matched;
    });

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

  private async scanChain(
    chain: SupportedChain,
    input: EvmScanInput | StellarScanInput | SolanaScanInput | CkbScanInput,
    signal?: AbortSignal,
  ): Promise<unknown[]> {
    if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');

    switch (chain) {
      case 'evm': {
        const { scanAnnouncements } = await import('./chains/evm/scan');
        const i = input as EvmScanInput;
        const total = i.announcements.length;
        this.emit({ chain, processed: 0, total });
        const result = scanAnnouncements(
          i.announcements,
          i.viewingKey,
          i.spendingPubKey,
          i.spendingKey,
        );
        this.emit({ chain, processed: total, total });
        return result;
      }
      case 'stellar': {
        const { scanAnnouncements } = await import('./chains/stellar/scan');
        const i = input as StellarScanInput;
        const total = i.announcements.length;
        this.emit({ chain, processed: 0, total });
        const result = scanAnnouncements(
          i.announcements,
          i.viewingKey,
          i.spendingPubKey,
          i.spendingScalar,
        );
        this.emit({ chain, processed: total, total });
        return result;
      }
      case 'solana': {
        const { scanAnnouncements } = await import('./chains/solana/scan');
        const i = input as SolanaScanInput;
        const total = i.announcements.length;
        this.emit({ chain, processed: 0, total });
        const result = scanAnnouncements(
          i.announcements,
          i.viewingKey,
          i.spendingPubKey,
          i.spendingScalar,
        );
        this.emit({ chain, processed: total, total });
        return result;
      }
      case 'ckb': {
        const { scanStealthCells } = await import('./chains/ckb/scan');
        const i = input as CkbScanInput;
        const total = i.cells.length;
        this.emit({ chain, processed: 0, total });
        const result = scanStealthCells(i.cells, i.viewingKey, i.spendingPubKey, i.spendingKey);
        this.emit({ chain, processed: total, total });
        return result;
      }
      default:
        throw new Error(`Unsupported chain: ${chain}`);
    }
  }
}
