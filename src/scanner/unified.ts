import type {
  Announcement as EvmAnnouncement,
  MatchedAnnouncement as EvmMatchedAnnouncement,
  HexString as EvmHexString,
} from '../chains/evm/types';
import type {
  Announcement as StellarAnnouncement,
  MatchedAnnouncement as StellarMatchedAnnouncement,
} from '../chains/stellar/types';
import type {
  Announcement as SolanaAnnouncement,
  MatchedAnnouncement as SolanaMatchedAnnouncement,
} from '../chains/solana/types';
import type {
  StealthCell as CkbCell,
  MatchedStealthCell as CkbMatchedCell,
  HexString as CkbHexString,
} from '../chains/ckb/types';
import { adapter as evmAdapter } from '../chains/evm/scan';
import { adapter as stellarAdapter } from '../chains/stellar/scan';
import { adapter as solanaAdapter } from '../chains/solana/scan';
import { adapter as ckbAdapter } from '../chains/ckb/scan';

/**
 * Supported in-tree chain identifiers.
 */
export type SupportedChain = 'evm' | 'stellar' | 'solana' | 'ckb';

/**
 * Interface that all chain scanner adapters must implement for third-party chain extensibility.
 *
 * @template TItem - Raw announcement/cell item type.
 * @template TKeys - Recipient key material required to detect/spend stealth payments.
 * @template TMatched - Matched announcement output type.
 * @template TMetaAddress - Decoded stealth meta-address representation.
 */
export interface ChainScannerAdapter<TItem = any, TKeys = any, TMatched = any, TMetaAddress = any> {
  /** Unique string identifier for the chain adapter (e.g., 'evm', 'stellar', 'monero'). */
  id: string;

  /**
   * Scans an async iterable stream of announcements for stealth payment matches.
   *
   * @param source - Async iterable stream of raw announcements or cells.
   * @param keys - Keys required by the adapter.
   */
  scan(source: AsyncIterable<TItem>, keys: TKeys): AsyncGenerator<TMatched>;

  /**
   * Decodes a stealth meta-address string into key components.
   *
   * @param metaAddress - Encoded meta-address string.
   */
  decodeMetaAddress(metaAddress: string): TMetaAddress;

  /**
   * Encodes spending and viewing public keys into a stealth meta-address string.
   *
   * @param spendingPubKey - Public key used for spending derivation.
   * @param viewingPubKey - Public key used for viewing/ECDH derivation.
   */
  encodeMetaAddress(spendingPubKey: any, viewingPubKey: any): string;
}

/**
 * Input configuration for a custom third-party chain scanner adapter.
 */
export interface CustomChainInput<TItem = any, TKeys = any, TMatched = any> {
  /** Chain scanner adapter instance. */
  adapter: ChainScannerAdapter<TItem, TKeys, TMatched, any>;
  /** Async iterable stream of raw announcements/cells. */
  source: AsyncIterable<TItem>;
  /** Recipient key material required for scanning. */
  keys: TKeys;
}

export interface EvmChainInput {
  source: AsyncIterable<EvmAnnouncement>;
  viewingKey: EvmHexString;
  spendingPubKey: EvmHexString;
  spendingKey: EvmHexString;
}

export interface StellarChainInput {
  source: AsyncIterable<StellarAnnouncement>;
  viewingKey: Uint8Array;
  spendingPubKey: Uint8Array;
  spendingScalar: bigint;
}

export interface SolanaChainInput {
  source: AsyncIterable<SolanaAnnouncement>;
  viewingKey: Uint8Array;
  spendingPubKey: Uint8Array;
  spendingScalar: bigint;
}

export interface CkbChainInput {
  source: AsyncIterable<CkbCell>;
  viewingKey: CkbHexString;
  spendingPubKey: CkbHexString;
  spendingKey: CkbHexString;
}

export interface ScanAllInput {
  evm?: EvmChainInput;
  stellar?: StellarChainInput;
  solana?: SolanaChainInput;
  ckb?: CkbChainInput;
  adapters?: Array<CustomChainInput<any, any, any> | any>;
}

export type MatchedAnnouncement =
  | {
      chain: 'evm';
      timestamp: number;
      seq: number;
      announcement: EvmMatchedAnnouncement;
    }
  | {
      chain: 'stellar';
      timestamp: number;
      seq: number;
      announcement: StellarMatchedAnnouncement;
    }
  | {
      chain: 'solana';
      timestamp: number;
      seq: number;
      announcement: SolanaMatchedAnnouncement;
    }
  | {
      chain: 'ckb';
      timestamp: number;
      seq: number;
      announcement: CkbMatchedCell;
    }
  | {
      chain: string;
      timestamp: number;
      seq: number;
      announcement: any;
    };

async function* scanChainAdapterSource(
  adapter: ChainScannerAdapter<any, any, any, any>,
  source: AsyncIterable<any>,
  keys: any,
): AsyncGenerator<{ announcement: unknown; timestamp: number }> {
  const stream = adapter.scan(source, keys);
  const it = stream[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await it.next();
      if (next.done) break;
      yield { announcement: next.value, timestamp: 0 };
    }
  } finally {
    await it.return?.(undefined);
  }
}

export async function* scanAll(input: ScanAllInput): AsyncGenerator<MatchedAnnouncement> {
  const tasks: Array<{
    id: string;
    gen: AsyncGenerator<{ announcement: unknown; timestamp: number }>;
  }> = [];

  if (input.evm) {
    tasks.push({
      id: 'evm',
      gen: scanChainAdapterSource(evmAdapter, input.evm.source, {
        viewingKey: input.evm.viewingKey,
        spendingPubKey: input.evm.spendingPubKey,
        spendingKey: input.evm.spendingKey,
      }),
    });
  }

  if (input.stellar) {
    tasks.push({
      id: 'stellar',
      gen: scanChainAdapterSource(stellarAdapter, input.stellar.source, {
        viewingKey: input.stellar.viewingKey,
        spendingPubKey: input.stellar.spendingPubKey,
        spendingScalar: input.stellar.spendingScalar,
      }),
    });
  }

  if (input.solana) {
    tasks.push({
      id: 'solana',
      gen: scanChainAdapterSource(solanaAdapter, input.solana.source, {
        viewingKey: input.solana.viewingKey,
        spendingPubKey: input.solana.spendingPubKey,
        spendingScalar: input.solana.spendingScalar,
      }),
    });
  }

  if (input.ckb) {
    tasks.push({
      id: 'ckb',
      gen: scanChainAdapterSource(ckbAdapter, input.ckb.source, {
        viewingKey: input.ckb.viewingKey,
        spendingPubKey: input.ckb.spendingPubKey,
        spendingKey: input.ckb.spendingKey,
      }),
    });
  }

  if (input.adapters && Array.isArray(input.adapters)) {
    for (const item of input.adapters) {
      const adapter: ChainScannerAdapter | undefined =
        item.adapter ?? (item.id && item.scan ? item : undefined);
      const source = item.source ?? item.input?.source;
      const keys = item.keys ?? item.input?.keys;
      if (adapter && source) {
        tasks.push({
          id: adapter.id,
          gen: scanChainAdapterSource(adapter, source, keys),
        });
      }
    }
  }

  if (tasks.length === 0) return;

  const iterators = new Map<
    number,
    {
      chain: string;
      iter: AsyncIterator<{ announcement: unknown; timestamp: number }>;
      seq: number;
    }
  >();
  const pending = new Map<
    number,
    Promise<IteratorResult<{ announcement: unknown; timestamp: number }>>
  >();

  tasks.forEach((task, idx) => {
    const iter = task.gen[Symbol.asyncIterator]();
    iterators.set(idx, { chain: task.id, iter, seq: 0 });
    pending.set(idx, iter.next());
  });

  let active = iterators.size;

  try {
    while (active > 0) {
      const [idx, result] = await Promise.race(
        Array.from(pending.entries()).map(([i, p]) => p.then((r) => [i, r] as const)),
      );

      if (result.done) {
        pending.delete(idx);
        active--;
      } else {
        const entry = iterators.get(idx)!;
        const seq = entry.seq++;
        pending.set(idx, entry.iter.next());
        yield {
          chain: entry.chain,
          timestamp: result.value.timestamp,
          seq,
          announcement: result.value.announcement,
        } as MatchedAnnouncement;
      }
    }
  } finally {
    await Promise.all(Array.from(iterators.values()).map(({ iter }) => iter.return?.(undefined)));
  }
}
