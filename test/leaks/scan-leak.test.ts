import { describe, it, expect } from 'vitest';
import v8 from 'v8';
import fs from 'fs';
import path from 'path';
import type { Announcement } from '../../src/chains/stellar';

import {
  deriveStealthKeys,
  generateStealthAddress,
  scanAnnouncements,
  bytesToHex,
  SCHEME_ID,
} from '../../src/chains/stellar';

class LeakSentinel {
  readonly payload = new Uint8Array(64 * 1024);
}

const injectedLeak: LeakSentinel[] = [];

function envInt(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envFloat(name: string, fallback: number) {
  const value = Number.parseFloat(process.env[name] ?? '');
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function generateAnnouncements(
  count: number,
  spendingPubKey: Uint8Array,
  viewingPubKey: Uint8Array,
): Announcement[] {
  return Array.from({ length: count }, (_, i) => {
    const stealth = generateStealthAddress(spendingPubKey, viewingPubKey);

    return {
      schemeId: SCHEME_ID,
      stealthAddress: stealth.stealthAddress,
      caller: `G${'A'.repeat(55)}`,
      ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
      metadata: bytesToHex(Uint8Array.of(stealth.viewTag)),
      ledger: i,
    };
  });
}

function memoryMB() {
  const m = process.memoryUsage();
  const bytes = m.heapUsed + m.external + Number(m.arrayBuffers ?? 0);
  return bytes / 1024 / 1024;
}

/**
 * Linear regression slope:
 * MB per iteration
 */
function regressionSlope(y: number[]) {
  const n = y.length;
  const x = Array.from({ length: n }, (_, i) => i);

  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumXX = 0;

  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumXX += x[i] * x[i];
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  return slope;
}

function forceGc() {
  if (typeof global.gc !== 'function') {
    throw new Error('Leak regression harness requires Node to run with --expose-gc');
  }
  global.gc();
  global.gc();
}

function writeHeapSnapshot(label: string) {
  const snapshotStream = v8.getHeapSnapshot();
  const file = path.join(process.cwd(), `heap-${label}.heapsnapshot`);

  const writeStream = fs.createWriteStream(file);
  snapshotStream.pipe(writeStream);

  return new Promise<void>((resolve) => {
    writeStream.on('finish', () => resolve());
  });
}

function writeDiagnostics(diagnostics: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(process.cwd(), 'scan-leak-diagnostics.json'),
    `${JSON.stringify(diagnostics, null, 2)}\n`,
  );
}

describe('scanAnnouncements - CI leak detection', () => {
  it('detects memory leaks via regression + heap snapshots', async () => {
    const announcementsCount = envInt('SCAN_LEAK_ANNOUNCEMENTS', 50);
    const iterations = envInt('SCAN_LEAK_ITERATIONS', 200);
    const sampleInterval = envInt('SCAN_LEAK_SAMPLE_INTERVAL', 20);
    const threshold = envFloat('SCAN_LEAK_THRESHOLD_MB', 0.2);
    const injectLeak = process.env.SCAN_LEAK_INJECT === '1';

    const signature = new Uint8Array(64);
    crypto.getRandomValues(signature);

    const keys = deriveStealthKeys(signature);
    const data = generateAnnouncements(announcementsCount, keys.spendingPubKey, keys.viewingPubKey);

    // warmup
    for (let i = 0; i < 20; i++) {
      scanAnnouncements(data, keys.viewingKey, keys.spendingPubKey, keys.spendingScalar);
    }

    const samples: number[] = [];

    for (let i = 0; i < iterations; i++) {
      scanAnnouncements(data, keys.viewingKey, keys.spendingPubKey, keys.spendingScalar);
      if (injectLeak) injectedLeak.push(new LeakSentinel());

      if (i % sampleInterval === 0) {
        forceGc();
        samples.push(memoryMB());
      }
    }

    const slope = regressionSlope(samples);
    const failed = slope >= threshold;

    console.log('Heap samples:', samples);
    console.log('Leak slope (MB/step):', slope);

    // Compact diagnostic that CI uploads on failure. The full snapshot is large
    // and only written when the gate trips, so success runs stay cheap.
    writeDiagnostics({
      announcementsCount,
      iterations,
      sampleInterval,
      threshold,
      slope,
      injectLeak,
      samples,
    });

    if (failed) {
      await writeHeapSnapshot('final');
    }

    /**
     * CI GATE:
     * > 0.2 MB per sample step is suspicious for long-running agents
     */
    expect(slope).toBeLessThan(threshold);
  });
});
