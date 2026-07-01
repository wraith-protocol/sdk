/**
 * Benchmark: WebGPU scanner vs CPU optimized scanner
 *
 * Run with:
 *   STELLAR_SCAN_BENCH_SIZES=100000 pnpm vitest bench test/chains/stellar/bench/scan-webgpu.bench.ts
 *
 * In Node.js / vitest, WebGPU is not available — the GPU benches are skipped
 * with a clear message and CPU baseline numbers are reported.
 * In a browser or Node with WebGPU enabled, both paths run and are compared.
 */

import { bench, describe, test, expect, afterAll } from 'vitest';
import { deriveStealthKeys } from '../../../../src/chains/stellar/keys';
import {
  computeAnnouncementViewTag,
  computeSharedSecret,
  generateStealthAddress,
} from '../../../../src/chains/stellar/stealth';
import { scanAnnouncements } from '../../../../src/chains/stellar/scan';
import {
  scanAnnouncementsWebGPU,
  isWebGPUAvailable,
} from '../../../../src/chains/stellar/webgpu/scan-webgpu';
import { SCHEME_ID } from '../../../../src/chains/stellar/constants';
import { bytesToHex } from '../../../../src/chains/stellar/utils';
import type { Announcement, StealthKeys } from '../../../../src/chains/stellar/types';

// ---------------------------------------------------------------------------
// Fixture setup (mirrors scan.bench.ts)
// ---------------------------------------------------------------------------

const MATCH_INDEX = 997;
const POOL_SIZE = 512;
const DEFAULT_SIZES = [100_000] as const;
const DATASET_SIZES = (
  process.env.STELLAR_SCAN_BENCH_SIZES?.split(',').map(Number) ?? [...DEFAULT_SIZES]
).filter((n) => Number.isFinite(n) && n > 0);

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

function makeAnnouncement(recipient: StealthKeys, ephemeralSeed: Uint8Array): Announcement {
  const stealth = generateStealthAddress(
    recipient.spendingPubKey,
    recipient.viewingPubKey,
    ephemeralSeed,
  );
  const viewTag = computeAnnouncementViewTag(stealth.ephemeralPubKey, recipient.viewingPubKey);
  return {
    schemeId: SCHEME_ID,
    stealthAddress: stealth.stealthAddress,
    caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
    metadata: viewTag.toString(16).padStart(2, '0'),
  };
}

const foreignPool = Array.from({ length: POOL_SIZE }, (_, i) =>
  makeAnnouncement(foreignKeys, seedFor(i)),
);
const matchingAnn = makeAnnouncement(keys, seedFor(POOL_SIZE + 1));

function makeDataset(size: number): Announcement[] {
  return Array.from({ length: size }, (_, i) =>
    i === MATCH_INDEX ? matchingAnn : foreignPool[i % foreignPool.length],
  );
}

const datasets = new Map(DATASET_SIZES.map((size) => [size, makeDataset(size)]));

// ---------------------------------------------------------------------------
// Timing collector for the afterAll summary table
// ---------------------------------------------------------------------------

interface TimingRecord {
  label: string;
  ns: number;
  count: number;
}
const timings: TimingRecord[] = [];

function recordTiming(label: string, ns: number, count: number) {
  timings.push({ label, ns, count });
}

// ---------------------------------------------------------------------------
// Correctness check
// ---------------------------------------------------------------------------

describe('WebGPU scanner correctness', () => {
  test('CPU fallback (always runs): finds the match in 10k dataset', () => {
    const dataset = makeDataset(10_000);
    const matched = scanAnnouncements(
      dataset,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingScalar,
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].stealthAddress).toBe(matchingAnn.stealthAddress);
  });

  test('WebGPU async scanner: finds same matches as CPU on 10k dataset', async () => {
    const dataset = makeDataset(10_000);

    const cpuMatched = scanAnnouncements(
      dataset,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingScalar,
    );

    const gpuMatched = await scanAnnouncementsWebGPU(
      dataset,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingScalar,
    );

    // Must agree on which announcements matched
    expect(gpuMatched.map((m) => m.stealthAddress)).toEqual(
      cpuMatched.map((m) => m.stealthAddress),
    );
  });

  test('WebGPU availability logged', () => {
    if (isWebGPUAvailable()) {
      console.log('[webgpu-bench] WebGPU is AVAILABLE — GPU benchmarks will run');
    } else {
      console.log(
        '[webgpu-bench] WebGPU is NOT available (expected in Node/vitest) — GPU benchmarks skipped',
      );
    }
    // Not a failure either way
    expect(typeof isWebGPUAvailable()).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

for (const size of DATASET_SIZES) {
  const dataset = datasets.get(size)!;

  describe(`Stellar scanner benchmark — ${size.toLocaleString()} announcements`, () => {
    bench(
      `cpu: public view-tag prefilter (${size.toLocaleString()})`,
      () => {
        scanAnnouncements(dataset, keys.viewingKey, keys.spendingPubKey, keys.spendingScalar);
      },
      {
        ...BENCH_OPTIONS,
        setup() {
          /* no-op */
        },
      },
    );

    bench(
      `webgpu: batch view-tag + ECDH (${size.toLocaleString()})`,
      async () => {
        if (!isWebGPUAvailable()) {
          // Not a failure — record that we skipped and return immediately
          return;
        }
        await scanAnnouncementsWebGPU(
          dataset,
          keys.viewingKey,
          keys.spendingPubKey,
          keys.spendingScalar,
        );
      },
      BENCH_OPTIONS,
    );

    // Manual wall-clock timing for ns/announcement metric
    afterAll(async () => {
      const iters = 3;

      // CPU
      const cpuStart = performance.now();
      for (let i = 0; i < iters; i++) {
        scanAnnouncements(dataset, keys.viewingKey, keys.spendingPubKey, keys.spendingScalar);
      }
      const cpuMs = (performance.now() - cpuStart) / iters;
      const cpuNs = cpuMs * 1e6;
      recordTiming(`cpu (${size.toLocaleString()})`, cpuNs, size);
      console.log(
        `[webgpu-bench] CPU  ${size.toLocaleString()} anns: ${cpuMs.toFixed(2)} ms` +
          ` (~${(cpuNs / size).toFixed(1)} ns/ann)`,
      );

      if (!isWebGPUAvailable()) {
        console.log(
          `[webgpu-bench] GPU  ${size.toLocaleString()} anns: SKIPPED (WebGPU not available)`,
        );
        return;
      }

      // GPU (warm — first call may pay pipeline init cost)
      const gpuWarmStart = performance.now();
      await scanAnnouncementsWebGPU(
        dataset,
        keys.viewingKey,
        keys.spendingPubKey,
        keys.spendingScalar,
      );
      const gpuWarmMs = performance.now() - gpuWarmStart;

      const gpuStart = performance.now();
      for (let i = 0; i < iters; i++) {
        await scanAnnouncementsWebGPU(
          dataset,
          keys.viewingKey,
          keys.spendingPubKey,
          keys.spendingScalar,
        );
      }
      const gpuMs = (performance.now() - gpuStart) / iters;
      const gpuNs = gpuMs * 1e6;
      recordTiming(`gpu (${size.toLocaleString()})`, gpuNs, size);

      const speedup = cpuMs / gpuMs;
      console.log(
        `[webgpu-bench] GPU  ${size.toLocaleString()} anns: ${gpuMs.toFixed(2)} ms (warm)` +
          ` / ${gpuWarmMs.toFixed(0)} ms (cold)` +
          ` (~${(gpuNs / size).toFixed(1)} ns/ann)` +
          ` | speedup vs CPU: ${speedup.toFixed(2)}x`,
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Summary table (printed once at the end)
// ---------------------------------------------------------------------------

afterAll(() => {
  if (timings.length === 0) return;

  console.log('\n[webgpu-bench] ── Summary ─────────────────────────────────────');
  console.log(
    `${'Variant'.padEnd(30)} ${'Total ms'.padStart(12)} ${'ns/ann'.padStart(10)} ${'vs CPU'.padStart(10)}`,
  );
  console.log('─'.repeat(66));

  // Group by size
  const cpuBySize = new Map<number, number>();
  for (const t of timings) {
    const match = t.label.match(/\(([0-9,]+)\)/);
    if (!match) continue;
    const sz = parseInt(match[1].replace(/,/g, ''), 10);
    if (t.label.startsWith('cpu')) cpuBySize.set(sz, t.ns);
  }

  for (const t of timings) {
    const match = t.label.match(/\(([0-9,]+)\)/);
    if (!match) continue;
    const sz = parseInt(match[1].replace(/,/g, ''), 10);
    const ms = (t.ns / 1e6).toFixed(2);
    const nsPerAnn = (t.ns / t.count).toFixed(1);
    const cpu = cpuBySize.get(sz);
    const speedup = cpu && !t.label.startsWith('cpu') ? `${(cpu / t.ns).toFixed(2)}x` : '—';
    console.log(
      `${t.label.padEnd(30)} ${ms.padStart(12)} ${nsPerAnn.padStart(10)} ${speedup.padStart(10)}`,
    );
  }
  console.log('─'.repeat(66));

  const gpuAvail = isWebGPUAvailable();
  if (!gpuAvail) {
    console.log('\n  ⚠  GPU rows absent: WebGPU not available in this environment.');
    console.log('     Run in Chrome 113+ or Node 22+ with --experimental-webgpu for GPU numbers.');
  }
  console.log('[webgpu-bench] ────────────────────────────────────────────────\n');
});
