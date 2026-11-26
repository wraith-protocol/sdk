import { afterAll, bench, describe } from 'vitest';
import { MultichainScannerPool } from '../../src/scanner-pool';
import type { Announcement as EvmAnnouncement } from '../../src/chains/evm/types';
import type { Announcement as SolanaAnnouncement } from '../../src/chains/solana/types';

/**
 * Compares the bounded streaming pool across provider profiles.
 *
 * Each profile runs the same two-chain scan through a source that simulates a
 * provider: optional per-pull latency, periodic rate-limit backoff, or a hard
 * provider error partway through. Throughput comes from vitest's bench loop;
 * peak buffered announcements and heap growth are recorded per profile and
 * printed once at the end.
 *
 * Run with `pnpm bench`.
 */

const evmKeys = {
  viewingKey: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as const,
  spendingPubKey: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' as const,
  spendingKey: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as const,
};

const solanaKeys = {
  viewingKey: new Uint8Array(32).fill(0xcc),
  spendingPubKey: new Uint8Array(32).fill(0xdd),
  spendingScalar: 123456789n,
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const evmItem = { schemeId: 0n } as unknown as EvmAnnouncement;
const solanaItem = { schemeId: 0 } as unknown as SolanaAnnouncement;

interface Profile {
  name: string;
  items: number;
  latencyMs?: number;
  /** Every nth pull pays an extra `backoffMs`, like a rate-limited provider. */
  everyNthPull?: number;
  backoffMs?: number;
  /** Throw after this many pulls, like a provider that starts failing. */
  errorAfter?: number;
}

interface Sample {
  peakBuffered: number;
  peakInFlight: number;
  heapDeltaBytes: number;
}

const samples = new Map<string, Sample>();

function simulatedSource<T>(
  item: T,
  profile: Profile,
  counters: { inFlight: number; peakInFlight: number },
): AsyncIterable<T> {
  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      let produced = 0;
      let pulls = 0;
      return {
        next: async (): Promise<IteratorResult<T>> => {
          pulls++;
          counters.inFlight++;
          counters.peakInFlight = Math.max(counters.peakInFlight, counters.inFlight);
          try {
            if (profile.latencyMs) await delay(profile.latencyMs);
            if (profile.everyNthPull && pulls % profile.everyNthPull === 0) {
              await delay(profile.backoffMs ?? 10);
            }
            if (profile.errorAfter !== undefined && produced >= profile.errorAfter) {
              throw new Error('provider unavailable');
            }
            if (produced >= profile.items) return { done: true, value: undefined };
            produced++;
            return { done: false, value: item };
          } finally {
            counters.inFlight--;
          }
        },
        return: async (): Promise<IteratorResult<T>> => ({ done: true, value: undefined }),
      };
    },
  };
  return iterable;
}

async function runProfile(profile: Profile): Promise<void> {
  const pool = new MultichainScannerPool({
    chains: ['evm', 'solana'],
    concurrency: 2,
    requestBudget: {
      maxRequests: 10_000,
      maxInFlightRequests: 2,
      maxBufferedAnnouncements: 128,
    },
  });

  let peakBuffered = 0;
  pool.on('progress', (event) => {
    peakBuffered = Math.max(peakBuffered, event.buffered ?? 0);
  });

  const counters = { inFlight: 0, peakInFlight: 0 };
  const heapBefore = process.memoryUsage().heapUsed;

  await pool
    .scanAll({
      evm: {
        source: simulatedSource(evmItem, profile, counters),
        ...evmKeys,
      },
      solana: {
        source: simulatedSource(solanaItem, profile, counters),
        ...solanaKeys,
      },
    })
    .catch(() => {
      // The error profile is expected to reject; the measurement still stands.
    });

  const current = samples.get(profile.name);
  const heapDeltaBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore);
  samples.set(profile.name, {
    peakBuffered: Math.max(current?.peakBuffered ?? 0, peakBuffered),
    peakInFlight: Math.max(current?.peakInFlight ?? 0, counters.peakInFlight),
    heapDeltaBytes,
  });
}

const PROFILES: Profile[] = [
  { name: 'local source (no latency)', items: 400 },
  { name: 'slow provider (10ms/pull)', items: 60, latencyMs: 10 },
  {
    name: 'rate-limited provider (backoff every 5 pulls)',
    items: 150,
    latencyMs: 1,
    everyNthPull: 5,
    backoffMs: 25,
  },
  { name: 'failing provider (error after 20 pulls)', items: 200, latencyMs: 1, errorAfter: 20 },
];

const BENCH_OPTIONS = { time: 400 };

describe('MultichainScannerPool – streaming profiles', () => {
  for (const profile of PROFILES) {
    bench(
      profile.name,
      async () => {
        await runProfile(profile);
      },
      BENCH_OPTIONS,
    );
  }
});

afterAll(() => {
  const rows = Array.from(samples.entries()).map(([name, sample]) => ({
    profile: name,
    'peak buffered': sample.peakBuffered,
    'peak in-flight': sample.peakInFlight,
    'heap delta (KB)': Math.round(sample.heapDeltaBytes / 1024),
  }));
  // eslint-disable-next-line no-console
  console.table(rows);
});
