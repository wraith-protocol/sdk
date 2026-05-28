import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeHeapSnapshot } from 'node:v8';
import { describe, expect, test } from 'vitest';
import { SCHEME_ID } from '../../src/chains/evm/constants';
import { deriveStealthKeys } from '../../src/chains/evm/keys';
import { scanAnnouncements } from '../../src/chains/evm/scan';
import { generateStealthAddress } from '../../src/chains/evm/stealth';
import type { Announcement, HexString, MatchedAnnouncement } from '../../src/chains/evm/types';

declare global {
  // eslint-disable-next-line no-var
  var gc: (() => void) | undefined;
}

interface MemorySample {
  iteration: number;
  timestamp: string;
  rss: number;
  heapUsed: number;
  external: number;
}

interface LeakConfig {
  iterations: number;
  announcements: number;
  sampleInterval: number;
  snapshotInterval: number;
  maxRssSlopeKb: number;
}

const artifactDir = join(process.cwd(), 'test', 'leak', 'artifacts');
const testSignature = `0x${'aa'.repeat(32)}${'bb'.repeat(32)}1b` as HexString;

function readPositiveInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${value}`);
  }

  return parsed;
}

function readNonNegativeInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${value}`);
  }

  return parsed;
}

function readPositiveNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number, got ${value}`);
  }

  return parsed;
}

function getLeakConfig(): LeakConfig {
  return {
    iterations: readPositiveInteger('LEAK_ITERATIONS', 10_000),
    announcements: readPositiveInteger('LEAK_ANNOUNCEMENTS', 10_000),
    sampleInterval: readPositiveInteger('LEAK_SAMPLE_INTERVAL', 100),
    snapshotInterval: readNonNegativeInteger('LEAK_SNAPSHOT_INTERVAL', 2_500),
    maxRssSlopeKb: readPositiveNumber('LEAK_MAX_RSS_SLOPE_KB', 2),
  };
}

function makeEphemeralPrivateKey(index: number): HexString {
  return `0x${(BigInt(index) + 1n).toString(16).padStart(64, '0')}` as HexString;
}

function makeSyntheticAnnouncements(count: number): Announcement[] {
  const keys = deriveStealthKeys(testSignature);
  const matching = generateStealthAddress(
    keys.spendingPubKey,
    keys.viewingPubKey,
    makeEphemeralPrivateKey(1),
  );

  return Array.from({ length: count }, (_, index): Announcement => {
    if (index === 0) {
      return {
        schemeId: SCHEME_ID,
        stealthAddress: matching.stealthAddress,
        caller: `0x${'00'.repeat(20)}` as HexString,
        ephemeralPubKey: matching.ephemeralPubKey,
        metadata: `0x${matching.viewTag.toString(16).padStart(2, '0')}` as HexString,
      };
    }

    if (index % 256 === 0) {
      const foreignKeys = deriveStealthKeys(
        `0x${index.toString(16).padStart(64, '0')}${(index + 1)
          .toString(16)
          .padStart(64, '0')}1c` as HexString,
      );
      const foreign = generateStealthAddress(
        foreignKeys.spendingPubKey,
        foreignKeys.viewingPubKey,
        makeEphemeralPrivateKey(index + 1),
      );

      return {
        schemeId: SCHEME_ID,
        stealthAddress: foreign.stealthAddress,
        caller: `0x${'11'.repeat(20)}` as HexString,
        ephemeralPubKey: foreign.ephemeralPubKey,
        metadata: `0x${foreign.viewTag.toString(16).padStart(2, '0')}` as HexString,
      };
    }

    return {
      schemeId: 99n,
      stealthAddress: `0x${index.toString(16).padStart(40, '0')}` as HexString,
      caller: `0x${'22'.repeat(20)}` as HexString,
      ephemeralPubKey: `0x02${index.toString(16).padStart(64, '0')}` as HexString,
      metadata: `0x${(index % 256).toString(16).padStart(2, '0')}` as HexString,
    };
  });
}

function scanAnnouncementsAdapter(
  announcements: Announcement[],
  keys: ReturnType<typeof deriveStealthKeys>,
): MatchedAnnouncement[] {
  // If scanAnnouncementsStream is added later, adapt it here while keeping the current
  // scanAnnouncements path as the baseline leak harness target.
  return scanAnnouncements(announcements, keys.viewingKey, keys.spendingPubKey, keys.spendingKey);
}

function sampleMemory(iteration: number): MemorySample {
  if (global.gc) global.gc();

  const memory = process.memoryUsage();
  return {
    iteration,
    timestamp: new Date().toISOString(),
    rss: memory.rss,
    heapUsed: memory.heapUsed,
    external: memory.external,
  };
}

function writeSnapshot(iteration: number): string {
  mkdirSync(artifactDir, { recursive: true });
  return writeHeapSnapshot(join(artifactDir, `scan-leak-${iteration}.heapsnapshot`));
}

function rssSlopeKbPerIteration(samples: MemorySample[]): number {
  if (samples.length < 2) return 0;

  const warmupSamples = Math.floor(samples.length * 0.1);
  const regressionSamples = samples.slice(warmupSamples);
  const xMean =
    regressionSamples.reduce((total, sample) => total + sample.iteration, 0) /
    regressionSamples.length;
  const yMean =
    regressionSamples.reduce((total, sample) => total + sample.rss / 1024, 0) /
    regressionSamples.length;

  let numerator = 0;
  let denominator = 0;

  for (const sample of regressionSamples) {
    const xDelta = sample.iteration - xMean;
    const yDelta = sample.rss / 1024 - yMean;
    numerator += xDelta * yDelta;
    denominator += xDelta * xDelta;
  }

  return denominator === 0 ? 0 : numerator / denominator;
}

async function expectAnnouncementsArrayCollectable(): Promise<void> {
  if (typeof WeakRef === 'undefined' || typeof FinalizationRegistry === 'undefined') {
    console.info('Skipping GC retention check: WeakRef or FinalizationRegistry is unavailable.');
    return;
  }

  if (!global.gc) {
    console.info('Skipping GC retention check: run test:leak to enable --expose-gc.');
    return;
  }

  const keys = deriveStealthKeys(testSignature);
  let finalized = false;
  const registry = new FinalizationRegistry(() => {
    finalized = true;
  });

  const ref = (() => {
    let announcements: Announcement[] | undefined = makeSyntheticAnnouncements(10_000);
    const weakRef = new WeakRef(announcements);
    registry.register(announcements, 'announcements');

    expect(scanAnnouncementsAdapter(announcements, keys)).toHaveLength(1);
    announcements = undefined;

    return weakRef;
  })();

  await new Promise((resolve) => setTimeout(resolve, 0));

  for (let i = 0; i < 5; i++) {
    global.gc();
    const pressure = Array.from({ length: 16 }, () => new Uint8Array(1024 * 1024));
    pressure.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (ref.deref() === undefined || finalized) break;
  }

  expect(ref.deref() === undefined, 'announcements array should be collectible after scan').toBe(
    true,
  );
}

describe('scanAnnouncements leak harness', () => {
  test(
    'keeps RSS growth within the configured slope threshold',
    async () => {
      const config = getLeakConfig();
      const keys = deriveStealthKeys(testSignature);
      const announcements = makeSyntheticAnnouncements(config.announcements);
      const samples: MemorySample[] = [];
      const snapshots: string[] = [];

      mkdirSync(artifactDir, { recursive: true });
      samples.push(sampleMemory(0));

      for (let iteration = 1; iteration <= config.iterations; iteration++) {
        const matched = scanAnnouncementsAdapter(announcements, keys);
        expect(matched).toHaveLength(1);

        if (iteration % config.sampleInterval === 0 || iteration === config.iterations) {
          samples.push(sampleMemory(iteration));
        }

        if (
          config.snapshotInterval > 0 &&
          (iteration % config.snapshotInterval === 0 || iteration === config.iterations)
        ) {
          snapshots.push(writeSnapshot(iteration));
        }
      }

      const metricsPath = join(artifactDir, 'scan-leak-metrics.json');
      writeFileSync(
        metricsPath,
        JSON.stringify(
          {
            config,
            samples,
            snapshots,
          },
          null,
          2,
        ),
      );

      const slope = rssSlopeKbPerIteration(samples);
      const firstRss = samples[0].rss;
      const lastRss = samples[samples.length - 1].rss;
      const rssDelta = lastRss - firstRss;

      expect(
        slope,
        [
          `RSS slope exceeded leak threshold.`,
          `observed=${slope.toFixed(4)} KB/iteration`,
          `allowed=${config.maxRssSlopeKb.toFixed(4)} KB/iteration`,
          `firstRss=${Math.round(firstRss / 1024)} KB`,
          `lastRss=${Math.round(lastRss / 1024)} KB`,
          `totalRssDelta=${Math.round(rssDelta / 1024)} KB`,
          `sampleCount=${samples.length}`,
          `artifactPath=${artifactDir}`,
        ].join('\n'),
      ).toBeLessThanOrEqual(config.maxRssSlopeKb);

      await expectAnnouncementsArrayCollectable();

      // TODO(issue-17): when the optional browser cache layer lands, assert its documented
      // 50 MB cap and eviction behavior here via feature detection of the real cache API.
    },
    30 * 60 * 1000,
  );
});
