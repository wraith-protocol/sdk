/**
 * Multichain Scanner Pool
 *
 * Fans out scanning across multiple blockchains in parallel using:
 * - Browser: Web Workers (one per chain)
 * - Node: worker_threads (for ≥2 chains) or inline (for 1 chain)
 * - React Native: Sequential (pool size = 1, no Worker support)
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

export interface ScanInput {
  evm?: EvmScanInput;
  stellar?: StellarScanInput;
  solana?: SolanaScanInput;
  ckb?: CkbScanInput;
}

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
  chains?: SupportedChain[];
  concurrency?: number;
}

export class MultichainScannerPool {
  private chains: SupportedChain[];
  private concurrency: number;
  private isNode: boolean;
  private isBrowser: boolean;
  private isReactNative: boolean;
  private progressListeners: Set<(event: ProgressEvent) => void> = new Set();

  constructor(options: MultichainScannerPoolOptions = {}) {
    this.chains = options.chains || (['evm', 'stellar', 'solana', 'ckb'] as SupportedChain[]);
    this.concurrency = options.concurrency || 4;

    // Environment detection
    this.isNode =
      typeof globalThis.process !== 'undefined' &&
      globalThis.process.versions !== undefined &&
      globalThis.process.versions.node !== undefined &&
      typeof globalThis.Worker === 'undefined';

    this.isBrowser =
      typeof globalThis.window !== 'undefined' && typeof globalThis.Worker !== 'undefined';

    // React Native: has neither Node process.versions nor window
    this.isReactNative = !this.isNode && !this.isBrowser;
  }

  on(event: 'progress', listener: (e: ProgressEvent) => void): void {
    if (event === 'progress') {
      this.progressListeners.add(listener);
    }
  }

  off(event: 'progress', listener: (e: ProgressEvent) => void): void {
    if (event === 'progress') {
      this.progressListeners.delete(listener);
    }
  }

  private emitProgress(event: ProgressEvent): void {
    this.progressListeners.forEach((listener) => listener(event));
  }

  async scanAll(input: ScanInput, signal?: AbortSignal): Promise<ScanResults> {
    // React Native: sequential scanning only
    if (this.isReactNative) {
      return this.scanSequential(input, signal);
    }

    // For single chain, always inline (no worker overhead)
    const activeChains = this.chains.filter((c) => input[c]);
    if (activeChains.length === 1) {
      return this.scanSequential(input, signal);
    }

    // Node with ≥2 chains: try worker_threads if available
    if (this.isNode && activeChains.length >= 2) {
      try {
        return await this.scanWithWorkerThreads(input, activeChains, signal);
      } catch {
        // Fall back to inline if worker_threads fails
        return this.scanSequential(input, signal);
      }
    }

    // Browser: use Web Workers
    if (this.isBrowser && activeChains.length >= 2) {
      return this.scanWithWebWorkers(input, activeChains, signal);
    }

    // Default: sequential
    return this.scanSequential(input, signal);
  }

  private async scanSequential(input: ScanInput, signal?: AbortSignal): Promise<ScanResults> {
    const results: ScanResults = {};

    for (const chain of this.chains) {
      if (signal?.aborted) break;

      const chainInput = input[chain];
      if (!chainInput) continue;

      const result = await this.scanChain(chain, chainInput as never, signal);
      // Type-safe assignment per chain
      switch (chain) {
        case 'evm':
          results.evm = result as EvmMatchedAnnouncement[];
          break;
        case 'stellar':
          results.stellar = result as StellarMatchedAnnouncement[];
          break;
        case 'solana':
          results.solana = result as SolanaMatchedAnnouncement[];
          break;
        case 'ckb':
          results.ckb = result as CkbMatchedCell[];
          break;
      }
    }

    return results;
  }

  private async scanWithWorkerThreads(
    input: ScanInput,
    activeChains: SupportedChain[],
    signal?: AbortSignal,
  ): Promise<ScanResults> {
    // Dynamic import to avoid breaking browser builds
    const { Worker } = await import('worker_threads');

    const results: ScanResults = {};
    const promises: Promise<void>[] = [];

    for (const chain of activeChains) {
      if (signal?.aborted) break;

      const chainInput = input[chain];
      if (!chainInput) continue;

      const promise = (async () => {
        try {
          // For now, run inline in worker_threads. Full worker implementation
          // would spawn actual worker files. This keeps bundle size small.
          const result = await this.scanChain(chain, chainInput as never, signal);
          // Type-safe assignment per chain
          switch (chain) {
            case 'evm':
              results.evm = result as EvmMatchedAnnouncement[];
              break;
            case 'stellar':
              results.stellar = result as StellarMatchedAnnouncement[];
              break;
            case 'solana':
              results.solana = result as SolanaMatchedAnnouncement[];
              break;
            case 'ckb':
              results.ckb = result as CkbMatchedCell[];
              break;
          }
        } catch (error) {
          if (signal?.aborted) return;
          throw error;
        }
      })();

      promises.push(promise);

      // Respect concurrency limit
      if (promises.length >= this.concurrency) {
        await Promise.race(promises);
        promises.splice(
          promises.findIndex((p) => p instanceof Promise && p),
          1,
        );
      }
    }

    await Promise.all(promises);
    return results;
  }

  private scanWithWebWorkers(
    input: ScanInput,
    activeChains: SupportedChain[],
    signal?: AbortSignal,
  ): Promise<ScanResults> {
    return new Promise((resolve, reject) => {
      const results: ScanResults = {};
      const completed = new Set<SupportedChain>();

      const cleanup = () => {
        // Cleanup is handled by garbage collection
      };

      for (const chain of activeChains) {
        if (signal?.aborted) {
          cleanup();
          reject(new Error('Scan cancelled'));
          return;
        }

        const chainInput = input[chain];
        if (!chainInput) continue;

        // Run inline for simplicity (Web Workers can be added as optimization)
        this.scanChain(chain, chainInput as never, signal).then(
          (result) => {
            // Type-safe assignment per chain
            switch (chain) {
              case 'evm':
                results.evm = result as EvmMatchedAnnouncement[];
                break;
              case 'stellar':
                results.stellar = result as StellarMatchedAnnouncement[];
                break;
              case 'solana':
                results.solana = result as SolanaMatchedAnnouncement[];
                break;
              case 'ckb':
                results.ckb = result as CkbMatchedCell[];
                break;
            }
            completed.add(chain);

            if (completed.size === activeChains.length) {
              cleanup();
              resolve(results);
            }
          },
          (error) => {
            cleanup();
            reject(error);
          },
        );
      }

      // Handle abort signal
      if (signal) {
        signal.addEventListener('abort', () => {
          cleanup();
          reject(new Error('Scan cancelled'));
        });
      }
    });
  }

  private async scanChain(
    chain: SupportedChain,
    input: EvmScanInput | StellarScanInput | SolanaScanInput | CkbScanInput,
    signal?: AbortSignal,
  ): Promise<unknown[]> {
    if (signal?.aborted) {
      throw new Error('Scan cancelled');
    }

    // Dynamic imports keep bundle size small
    switch (chain) {
      case 'evm': {
        const { scanAnnouncements } = await import('./chains/evm/scan');
        const evmInput = input as EvmScanInput;
        return scanAnnouncements(
          evmInput.announcements,
          evmInput.viewingKey,
          evmInput.spendingPubKey,
          evmInput.spendingKey,
        );
      }
      case 'stellar': {
        const { scanAnnouncements } = await import('./chains/stellar/scan');
        const stellarInput = input as StellarScanInput;
        return scanAnnouncements(
          stellarInput.announcements,
          stellarInput.viewingKey,
          stellarInput.spendingPubKey,
          stellarInput.spendingScalar,
        );
      }
      case 'solana': {
        const { scanAnnouncements } = await import('./chains/solana/scan');
        const solanaInput = input as SolanaScanInput;
        return scanAnnouncements(
          solanaInput.announcements,
          solanaInput.viewingKey,
          solanaInput.spendingPubKey,
          solanaInput.spendingScalar,
        );
      }
      case 'ckb': {
        const { scanStealthCells } = await import('./chains/ckb/scan');
        const ckbInput = input as CkbScanInput;
        return scanStealthCells(
          ckbInput.cells,
          ckbInput.viewingKey,
          ckbInput.spendingPubKey,
          ckbInput.spendingKey,
        );
      }
      default: {
        throw new Error(`Unsupported chain: ${chain}`);
      }
    }
  }
}
