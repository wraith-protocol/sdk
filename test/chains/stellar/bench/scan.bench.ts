import { bench, describe, expect, test } from 'vitest';
import { deriveStealthKeys } from '../../../../src/chains/stellar/keys';
import {
  computeAnnouncementViewTag,
  computeSharedSecret,
  computeViewTag,
  generateStealthAddress,
} from '../../../../src/chains/stellar/stealth';
import {
  scanAnnouncements,
  scanAnnouncementsStream,
  scanAnnouncementsStreamSequential,
  scanAnnouncementsLegacySharedSecretTag,
} from '../../../../src/chains/stellar/scan';
import { SCHEME_ID } from '../../../../src/chains/stellar/constants';
import { bytesToHex } from '../../../../src/chains/stellar/utils';
import type { Announcement, StealthKeys } from '../../../../src/chains/stellar/types';
import { fetchAnnouncementsStream } from '../../../../src/chains/stellar/announcements';

const MATCH_INDEX = 997;
const POOL_SIZE = 512;
const DEFAULT_DATASET_SIZES = [10_000, 100_000] as const;
const DATASET_SIZES = (
  process.env.STELLAR_SCAN_BENCH_SIZES?.split(',').map(Number) ?? [...DEFAULT_DATASET_SIZES]
).filter((size) => Number.isFinite(size) && size > 0);
const BENCH_OPTIONS = { time: 1, iterations: 1, warmupTime: 0, warmupIterations: 0 };

const keys = deriveStealthKeys(new Uint8Array(64).fill(0xaa));
const foreignKeys = deriveStealthKeys(new Uint8Array(64).fill(0xbb));

function seedFor(index: number): Uint8Array {
  const seed = new Uint8Array(32);
  let state = (index + 1) * 0x9e3779b1;
  for (let i = 0; i < seed.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    seed[i] = state & 0xff;
  }
  return seed;
}

function makeAnnouncementFor(
  recipient: StealthKeys,
  ephemeralSeed: Uint8Array,
  tagScheme: 'legacy-shared-secret' | 'public-announcement',
): Announcement {
  const stealth = generateStealthAddress(
    recipient.spendingPubKey,
    recipient.viewingPubKey,
    ephemeralSeed,
  );
  const sharedSecret = computeSharedSecret(ephemeralSeed, recipient.viewingPubKey);
  const viewTag =
    tagScheme === 'legacy-shared-secret'
      ? computeViewTag(sharedSecret)
      : computeAnnouncementViewTag(stealth.ephemeralPubKey, recipient.viewingPubKey);

  return {
    schemeId: SCHEME_ID,
    stealthAddress: stealth.stealthAddress,
    caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
    metadata: viewTag.toString(16).padStart(2, '0'),
  };
}

const pools = {
  legacy: Array.from({ length: POOL_SIZE }, (_, i) =>
    makeAnnouncementFor(foreignKeys, seedFor(i), 'legacy-shared-secret'),
  ),
  optimized: Array.from({ length: POOL_SIZE }, (_, i) =>
    makeAnnouncementFor(foreignKeys, seedFor(i), 'public-announcement'),
  ),
};

const matchingAnnouncements = {
  legacy: makeAnnouncementFor(keys, seedFor(POOL_SIZE + 1), 'legacy-shared-secret'),
  optimized: makeAnnouncementFor(keys, seedFor(POOL_SIZE + 1), 'public-announcement'),
};

function makeDataset(size: number, tagScheme: 'legacy' | 'optimized') {
  const foreignPool = pools[tagScheme];
  const matchingAnnouncement = matchingAnnouncements[tagScheme];

  return Array.from({ length: size }, (_, i) =>
    i === MATCH_INDEX ? matchingAnnouncement : foreignPool[i % foreignPool.length],
  );
}

const datasets = new Map(
  DATASET_SIZES.map((size) => [
    size,
    {
      legacy: makeDataset(size, 'legacy'),
      optimized: makeDataset(size, 'optimized'),
    },
  ]),
);

describe('Stellar scan benchmark fixtures', () => {
  test('optimized scanner preserves correctness on the 10k synthetic dataset', () => {
    const dataset = datasets.get(10_000)?.optimized;
    expect(dataset).toBeDefined();

    const matched = scanAnnouncements(
      dataset!,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingScalar,
    );

    expect(matched).toHaveLength(1);
    expect(matched[0].stealthAddress).toBe(matchingAnnouncements.optimized.stealthAddress);
  });
});

describe('Stellar scan announcement view-tag batching', () => {
  for (const size of DATASET_SIZES) {
    const dataset = datasets.get(size)!;

    bench(
      `before: shared-secret view tag (${size.toLocaleString()} announcements)`,
      () => {
        scanAnnouncementsLegacySharedSecretTag(
          dataset.legacy,
          keys.viewingKey,
          keys.spendingPubKey,
          keys.spendingScalar,
        );
      },
      BENCH_OPTIONS,
    );

    bench(
      `after: public view-tag prefilter (${size.toLocaleString()} announcements)`,
      () => {
        scanAnnouncements(
          dataset.optimized,
          keys.viewingKey,
          keys.spendingPubKey,
          keys.spendingScalar,
        );
      },
      BENCH_OPTIONS,
    );
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mimics fetchAnnouncementsStream's paging: one simulated RPC round trip per
 * `pageSize` announcements, each paying `pageLatencyMs` before its events are
 * available to the scanner.
 */
function paginatedMockSource(
  items: Announcement[],
  pageSize: number,
  pageLatencyMs: number,
): AsyncGenerator<Announcement> {
  return (async function* () {
    for (let offset = 0; offset < items.length; offset += pageSize) {
      await sleep(pageLatencyMs);
      const page = items.slice(offset, offset + pageSize);
      for (const item of page) yield item;
    }
  })();
}

async function drain<T>(source: AsyncIterable<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const value of source) results.push(value);
  return results;
}

const PAGE_SIZE = 1_000;
const PAGE_LATENCY_MS = 15;

describe('Stellar streaming scan pipelining', () => {
  test('pipelined scan finds the same match as the sequential scan', async () => {
    const dataset = datasets.get(10_000)?.optimized;
    expect(dataset).toBeDefined();

    const matched = await drain(
      scanAnnouncementsStream(
        paginatedMockSource(dataset!, PAGE_SIZE, PAGE_LATENCY_MS),
        keys.viewingKey,
        keys.spendingPubKey,
        keys.spendingScalar,
        { window: PAGE_SIZE },
      ),
    );

    expect(matched).toHaveLength(1);
    expect(matched[0].stealthAddress).toBe(matchingAnnouncements.optimized.stealthAddress);
  });

  for (const size of DATASET_SIZES) {
    const dataset = datasets.get(size)!.optimized;

    bench(
      `before: sequential window fetch-then-scan (${size.toLocaleString()} announcements)`,
      async () => {
        await drain(
          scanAnnouncementsStreamSequential(
            paginatedMockSource(dataset, PAGE_SIZE, PAGE_LATENCY_MS),
            keys.viewingKey,
            keys.spendingPubKey,
            keys.spendingScalar,
            { window: PAGE_SIZE },
          ),
        );
      },
      BENCH_OPTIONS,
    );

    bench(
      `after: pipelined fetch+scan (${size.toLocaleString()} announcements)`,
      async () => {
        await drain(
          scanAnnouncementsStream(
            paginatedMockSource(dataset, PAGE_SIZE, PAGE_LATENCY_MS),
            keys.viewingKey,
            keys.spendingPubKey,
            keys.spendingScalar,
            { window: PAGE_SIZE },
          ),
        );
      },
      BENCH_OPTIONS,
    );
  }
});

/**
 * Mock source that simulates parallel chunk fetching with variable latency.
 * Each chunk has a base latency plus random jitter to simulate real-world network variance.
 */
function parallelChunkMockSource(
  items: Announcement[],
  numChunks: number,
  baseLatencyMs: number,
  jitterMs: number,
): AsyncGenerator<Announcement> {
  return (async function* () {
    const chunkSize = Math.ceil(items.length / numChunks);
    const chunks: Array<{ items: Announcement[]; latency: number }> = [];

    for (let i = 0; i < numChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, items.length);
      const chunkItems = items.slice(start, end);
      const latency = baseLatencyMs + Math.random() * jitterMs;
      chunks.push({ items: chunkItems, latency });
    }

    // Simulate parallel fetching by starting all chunks concurrently
    const chunkPromises = chunks.map(async (chunk) => {
      await sleep(chunk.latency);
      return chunk.items;
    });

    // Wait for all chunks to complete
    const completedChunks = await Promise.all(chunkPromises);

    // Yield items in original order (simulating ordered merge)
    for (const chunk of completedChunks) {
      for (const item of chunk) {
        yield item;
      }
    }
  })();
}

describe('Stellar parallel horizon range chunking', () => {
  const PARALLEL_BENCH_SIZE = 50_000;
  const PARALLEL_BASE_LATENCY_MS = 50;
  const PARALLEL_JITTER_MS = 30;

  const parallelDataset = makeDataset(PARALLEL_BENCH_SIZE, 'optimized');

  test('parallel scan maintains correctness with 4 chunks', async () => {
    const matched = await drain(
      scanAnnouncementsStream(
        parallelChunkMockSource(parallelDataset, 4, PARALLEL_BASE_LATENCY_MS, PARALLEL_JITTER_MS),
        keys.viewingKey,
        keys.spendingPubKey,
        keys.spendingScalar,
        { window: PAGE_SIZE },
      ),
    );

    expect(matched).toHaveLength(1);
    expect(matched[0].stealthAddress).toBe(matchingAnnouncements.optimized.stealthAddress);
  });

  bench(
    `parallelism=1 (baseline) (${PARALLEL_BENCH_SIZE.toLocaleString()} announcements)`,
    async () => {
      await drain(
        scanAnnouncementsStream(
          parallelChunkMockSource(parallelDataset, 1, PARALLEL_BASE_LATENCY_MS, PARALLEL_JITTER_MS),
          keys.viewingKey,
          keys.spendingPubKey,
          keys.spendingScalar,
          { window: PAGE_SIZE },
        ),
      );
    },
    BENCH_OPTIONS,
  );

  bench(
    `parallelism=4 (${PARALLEL_BENCH_SIZE.toLocaleString()} announcements)`,
    async () => {
      await drain(
        scanAnnouncementsStream(
          parallelChunkMockSource(parallelDataset, 4, PARALLEL_BASE_LATENCY_MS, PARALLEL_JITTER_MS),
          keys.viewingKey,
          keys.spendingPubKey,
          keys.spendingScalar,
          { window: PAGE_SIZE },
        ),
      );
    },
    BENCH_OPTIONS,
  );

  bench(
    `parallelism=8 (${PARALLEL_BENCH_SIZE.toLocaleString()} announcements)`,
    async () => {
      await drain(
        scanAnnouncementsStream(
          parallelChunkMockSource(parallelDataset, 8, PARALLEL_BASE_LATENCY_MS, PARALLEL_JITTER_MS),
          keys.viewingKey,
          keys.spendingPubKey,
          keys.spendingScalar,
          { window: PAGE_SIZE },
        ),
      );
    },
    BENCH_OPTIONS,
  );
});
