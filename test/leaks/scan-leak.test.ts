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

function heapMB() {
  return process.memoryUsage().heapUsed / 1024 / 1024;
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

function writeHeapSnapshot(label: string) {
  const snapshotStream = v8.getHeapSnapshot();
  const file = path.join(process.cwd(), `heap-${label}.heapsnapshot`);

  const writeStream = fs.createWriteStream(file);
  snapshotStream.pipe(writeStream);

  return new Promise<void>((resolve) => {
    writeStream.on('finish', () => resolve());
  });
}

describe('scanAnnouncements - CI leak detection', () => {
  it('detects memory leaks via regression + heap snapshots', async () => {
    const signature = new Uint8Array(64);
    crypto.getRandomValues(signature);

    const keys = deriveStealthKeys(signature);
    const data = generateAnnouncements(10_000, keys.spendingPubKey, keys.viewingPubKey);

    // warmup
    for (let i = 0; i < 20; i++) {
      scanAnnouncements(data, keys.viewingKey, keys.spendingPubKey, keys.spendingScalar);
    }

    const samples: number[] = [];

    const iterations = 10_000;
    const sampleInterval = 250;

    for (let i = 0; i < iterations; i++) {
      scanAnnouncements(data, keys.viewingKey, keys.spendingPubKey, keys.spendingScalar);

      if (i % sampleInterval === 0) {
        global.gc?.();
        samples.push(heapMB());
      }
    }

    const slope = regressionSlope(samples);

    console.log('Heap samples:', samples);
    console.log('Leak slope (MB/step):', slope);

    // snapshot artifacts for CI debugging
    await writeHeapSnapshot('final');

    /**
     * CI GATE:
     * > 0.2 MB per sample step is suspicious for long-running agents
     */
    expect(slope).toBeLessThan(0.2);
  });
});
