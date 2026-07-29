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
import { scanAnnouncements as scanEvm } from '../chains/evm/scan';
import { scanAnnouncements as scanStellar } from '../chains/stellar/scan';
import { scanAnnouncements as scanSolana } from '../chains/solana/scan';
import { scanStealthCells as scanCkb } from '../chains/ckb/scan';

export type SupportedChain = 'evm' | 'stellar' | 'solana' | 'ckb';

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
    };

const WINDOW_SIZE = 64;

type ChainInput = EvmChainInput | StellarChainInput | SolanaChainInput | CkbChainInput;

async function* windowedScan<T, R>(
  source: AsyncIterable<T>,
  scanFn: (items: T[]) => R[],
): AsyncGenerator<R> {
  const iter = source[Symbol.asyncIterator]();
  try {
    while (true) {
      const batch: T[] = [];
      for (let i = 0; i < WINDOW_SIZE; i++) {
        const next = await iter.next();
        if (next.done) break;
        batch.push(next.value);
      }
      if (batch.length === 0) break;
      for (const result of scanFn(batch)) {
        yield result;
      }
      if (batch.length < WINDOW_SIZE) break;
    }
  } finally {
    await iter.return?.(undefined);
  }
}

async function* scanChainSource(
  chain: SupportedChain,
  input: ChainInput,
): AsyncGenerator<{ announcement: unknown; timestamp: number }> {
  const wrap = <T>(
    iter: AsyncGenerator<T>,
  ): AsyncGenerator<{ announcement: unknown; timestamp: number }> => {
    const it = iter[Symbol.asyncIterator]();
    const gen = (async function* () {
      try {
        while (true) {
          const next = await it.next();
          if (next.done) break;
          yield { announcement: next.value, timestamp: 0 };
        }
      } finally {
        await it.return?.(undefined);
      }
    })();
    return gen;
  };

  switch (chain) {
    case 'evm': {
      const { source, viewingKey, spendingPubKey, spendingKey } = input as EvmChainInput;
      yield* wrap(
        windowedScan(source, (batch) => scanEvm(batch, viewingKey, spendingPubKey, spendingKey)),
      );
      return;
    }
    case 'stellar': {
      const { source, viewingKey, spendingPubKey, spendingScalar } = input as StellarChainInput;
      yield* wrap(
        windowedScan(source, (batch) =>
          scanStellar(batch, viewingKey, spendingPubKey, spendingScalar),
        ),
      );
      return;
    }
    case 'solana': {
      const { source, viewingKey, spendingPubKey, spendingScalar } = input as SolanaChainInput;
      yield* wrap(
        windowedScan(source, (batch) =>
          scanSolana(batch, viewingKey, spendingPubKey, spendingScalar),
        ),
      );
      return;
    }
    case 'ckb': {
      const { source, viewingKey, spendingPubKey, spendingKey } = input as CkbChainInput;
      yield* wrap(
        windowedScan(source, (batch) => scanCkb(batch, viewingKey, spendingPubKey, spendingKey)),
      );
      return;
    }
  }
}

export async function* scanAll(input: ScanAllInput): AsyncGenerator<MatchedAnnouncement> {
  const entries = (Object.keys(input) as SupportedChain[])
    .filter((k) => input[k] !== undefined)
    .map((k) => [k, input[k]!] as [SupportedChain, ChainInput]);

  if (entries.length === 0) return;

  const iterators = new Map<
    SupportedChain,
    {
      iter: AsyncIterator<{ announcement: unknown; timestamp: number }>;
      seq: number;
    }
  >();
  const pending = new Map<
    SupportedChain,
    Promise<IteratorResult<{ announcement: unknown; timestamp: number }>>
  >();

  for (const [chain, config] of entries) {
    const gen = scanChainSource(chain, config);
    const iter = gen[Symbol.asyncIterator]();
    iterators.set(chain, { iter, seq: 0 });
    pending.set(chain, iter.next());
  }

  let active = iterators.size;

  try {
    while (active > 0) {
      const [chain, result] = await Promise.race(
        Array.from(pending.entries()).map(([c, p]) => p.then((r) => [c, r] as const)),
      );

      if (result.done) {
        pending.delete(chain);
        active--;
      } else {
        const entry = iterators.get(chain)!;
        const seq = entry.seq++;
        pending.set(chain, entry.iter.next());
        yield {
          chain,
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
