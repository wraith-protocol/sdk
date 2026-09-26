import fs from 'fs';
import path from 'path';
import v8 from 'v8';
import { describe, expect, it } from 'vitest';
import type { Announcement } from '../../src/chains/stellar';
import {
  bytesToHex,
  deriveStealthKeys,
  generateStealthAddress,
  scanAnnouncements,
  SCHEME_ID,
} from '../../src/chains/stellar';

type HeapSnapshot = {
  snapshot: {
    meta: {
      node_fields: string[];
      node_types: unknown[][];
    };
  };
  nodes: number[];
  strings: string[];
};

type ConstructorDiff = {
  constructor: string;
  before: number;
  after: number;
  growth: number;
};

class LeakSentinel {
  readonly payload = new Uint8Array(8 * 1024);
}

const injectedLeak: LeakSentinel[] = [];

function envInt(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function generateAnnouncements(
  count: number,
  spendingPubKey: Uint8Array,
  viewingPubKey: Uint8Array,
): Announcement[] {
  return Array.from({ length: count }, (_, i) => {
    const ephemeralSeed = new Uint8Array(32);
    new DataView(ephemeralSeed.buffer).setUint32(28, i + 1, false);
    const stealth = generateStealthAddress(spendingPubKey, viewingPubKey, ephemeralSeed);
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

function forceGc() {
  if (typeof global.gc !== 'function') {
    throw new Error('Heap regression harness requires Node to run with --expose-gc');
  }
  global.gc();
  global.gc();
}

function writeSnapshot(filename: string) {
  const output = path.join(process.cwd(), filename);
  v8.writeHeapSnapshot(output);
  return output;
}

function constructorCounts(snapshotPath: string) {
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as HeapSnapshot;
  const fields = snapshot.snapshot.meta.node_fields;
  const nodeTypes = snapshot.snapshot.meta.node_types[0] as string[];
  const width = fields.length;
  const typeOffset = fields.indexOf('type');
  const nameOffset = fields.indexOf('name');

  if (typeOffset < 0 || nameOffset < 0) {
    throw new Error('Unsupported V8 heap snapshot: missing node type/name fields');
  }

  const counts = new Map<string, number>();
  for (let offset = 0; offset < snapshot.nodes.length; offset += width) {
    const nodeType = nodeTypes[snapshot.nodes[offset + typeOffset]];
    if (nodeType !== 'object' && nodeType !== 'native') continue;

    const name = snapshot.strings[snapshot.nodes[offset + nameOffset]] || '(anonymous)';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

function diffCounts(before: Map<string, number>, after: Map<string, number>): ConstructorDiff[] {
  const constructors = new Set([...before.keys(), ...after.keys()]);
  return [...constructors]
    .map((constructor) => {
      const beforeCount = before.get(constructor) ?? 0;
      const afterCount = after.get(constructor) ?? 0;
      return {
        constructor,
        before: beforeCount,
        after: afterCount,
        growth: afterCount - beforeCount,
      };
    })
    .filter((entry) => entry.growth !== 0)
    .sort((a, b) => b.growth - a.growth || a.constructor.localeCompare(b.constructor));
}

describe('scanAnnouncements - constructor-level heap regression', () => {
  it('fails when retained constructor counts grow beyond the configured threshold', () => {
    const announcementsCount = envInt('HEAP_ANNOUNCEMENTS', 1_000);
    const scans = envInt('HEAP_SCANS', 100);
    const threshold = envInt('HEAP_CONSTRUCTOR_GROWTH_THRESHOLD', 25);
    const injectLeak = process.env.HEAP_LEAK_INJECT === '1';

    // Keep the workload deterministic so same-commit snapshot runs are comparable.
    const signature = Uint8Array.from({ length: 64 }, (_, index) => (index * 17 + 29) & 0xff);
    const keys = deriveStealthKeys(signature);
    const announcements = generateAnnouncements(
      announcementsCount,
      keys.spendingPubKey,
      keys.viewingPubKey,
    );

    for (let i = 0; i < 10; i++) {
      scanAnnouncements(announcements, keys.viewingKey, keys.spendingPubKey, keys.spendingScalar);
    }

    forceGc();
    const beforePath = writeSnapshot('heap-before.heapsnapshot');

    for (let i = 0; i < scans; i++) {
      scanAnnouncements(announcements, keys.viewingKey, keys.spendingPubKey, keys.spendingScalar);
      if (injectLeak) injectedLeak.push(new LeakSentinel());
    }

    forceGc();
    const afterPath = writeSnapshot('heap-after.heapsnapshot');

    const before = constructorCounts(beforePath);
    const after = constructorCounts(afterPath);
    const diff = diffCounts(before, after);
    const regressions = diff.filter((entry) => entry.growth > threshold);

    fs.writeFileSync(
      path.join(process.cwd(), 'heap-diff.json'),
      `${JSON.stringify(
        {
          config: { announcementsCount, scans, threshold, injectLeak },
          regressions,
          diff,
        },
        null,
        2,
      )}\n`,
    );

    console.log('Largest retained constructor growth:', diff.slice(0, 20));
    expect(regressions, `Retained constructor growth exceeded ${threshold}`).toEqual([]);
  });
});
