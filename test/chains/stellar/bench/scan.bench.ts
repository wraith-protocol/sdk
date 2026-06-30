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
  scanAnnouncementsLegacySharedSecretTag,
} from '../../../../src/chains/stellar/scan';
import { SCHEME_ID } from '../../../../src/chains/stellar/constants';
import { bytesToHex } from '../../../../src/chains/stellar/utils';
import type { Announcement, StealthKeys } from '../../../../src/chains/stellar/types';

const MATCH_INDEX = 997;
const POOL_SIZE = 512;
const DEFAULT_DATASET_SIZES = [10_000, 100_000, 1_000_000] as const;
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

async function makeAnnouncementFor(
  recipient: StealthKeys,
  ephemeralSeed: Uint8Array,
  tagScheme: 'legacy-shared-secret' | 'public-announcement',
): Promise<Announcement> {
  const stealth = await generateStealthAddress(
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

let pools: { legacy: Announcement[]; optimized: Announcement[] } | undefined;
let matchingAnnouncements: { legacy: Announcement; optimized: Announcement } | undefined;

async function initFixtures() {
  if (pools && matchingAnnouncements) return;
  pools = {
    legacy: await Promise.all(
      Array.from({ length: POOL_SIZE }, (_, i) =>
        makeAnnouncementFor(foreignKeys, seedFor(i), 'legacy-shared-secret'),
      ),
    ),
    optimized: await Promise.all(
      Array.from({ length: POOL_SIZE }, (_, i) =>
        makeAnnouncementFor(foreignKeys, seedFor(i), 'public-announcement'),
      ),
    ),
  };
  matchingAnnouncements = {
    legacy: await makeAnnouncementFor(keys, seedFor(POOL_SIZE + 1), 'legacy-shared-secret'),
    optimized: await makeAnnouncementFor(keys, seedFor(POOL_SIZE + 1), 'public-announcement'),
  };
}

function makeDataset(size: number, tagScheme: 'legacy' | 'optimized') {
  const foreignPool = pools![tagScheme];
  const matchingAnnouncement = matchingAnnouncements![tagScheme];

  return Array.from({ length: size }, (_, i) =>
    i === MATCH_INDEX ? matchingAnnouncement : foreignPool[i % foreignPool.length],
  );
}

async function getDatasets(): Promise<
  Map<number, { legacy: Announcement[]; optimized: Announcement[] }>
> {
  await initFixtures();
  return new Map(
    DATASET_SIZES.map((size) => [
      size,
      {
        legacy: makeDataset(size, 'legacy'),
        optimized: makeDataset(size, 'optimized'),
      },
    ]),
  );
}

describe('Stellar scan benchmark fixtures', () => {
  test('optimized scanner preserves correctness on the 10k synthetic dataset', async () => {
    const datasets = await getDatasets();
    const dataset = datasets.get(10_000)?.optimized;
    expect(dataset).toBeDefined();

    const matched = await scanAnnouncements(
      dataset!,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingScalar,
    );

    expect(matched).toHaveLength(1);
    expect(matched[0].stealthAddress).toBe(matchingAnnouncements!.optimized.stealthAddress);
  });
});

describe('Stellar scan announcement view-tag batching', () => {
  for (const size of DATASET_SIZES) {
    bench(
      `before: shared-secret view tag (${size.toLocaleString()} announcements)`,
      async () => {
        const datasets = await getDatasets();
        const dataset = datasets.get(size)!;
        await scanAnnouncementsLegacySharedSecretTag(
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
      async () => {
        const datasets = await getDatasets();
        const dataset = datasets.get(size)!;
        await scanAnnouncements(
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
