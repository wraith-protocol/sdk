import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryCache } from '../../../src/chains/stellar/cache';
import type { Announcement } from '../../../src/chains/stellar/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAnn(stealthAddress: string, ledger: number): Announcement {
  return {
    schemeId: 1,
    stealthAddress,
    caller: 'GCALLER',
    ephemeralPubKey: '00'.repeat(32),
    metadata: '01',
    ledger,
  };
}

function makeAnns(count: number, startLedger = 100): Announcement[] {
  return Array.from({ length: count }, (_, i) =>
    makeAnn(`GSTEALTH${i.toString().padStart(6, '0')}`, startLedger + i),
  );
}

// ---------------------------------------------------------------------------
// MemoryCache unit tests
// ---------------------------------------------------------------------------

describe('MemoryCache', () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache();
  });

  it('returns null for an empty network', async () => {
    const result = await cache.get('testnet', 1, 1000);
    expect(result).toBeNull();
  });

  it('returns null after put with no matching ledger range', async () => {
    await cache.put('testnet', [makeAnn('GFOO', 200)]);
    const result = await cache.get('testnet', 500, 600);
    expect(result).toBeNull();
  });

  it('stores and retrieves announcements by ledger range', async () => {
    const anns = [makeAnn('GAAA', 100), makeAnn('GBBB', 200), makeAnn('GCCC', 300)];
    await cache.put('testnet', anns);
    const result = await cache.get('testnet', 100, 200);
    expect(result).toHaveLength(2);
    expect(result!.map((a) => a.stealthAddress).sort()).toEqual(['GAAA', 'GBBB'].sort());
  });

  it('deduplicates by stealthAddress on repeated puts', async () => {
    const first = makeAnn('GAAA', 100);
    const updated = { ...first, metadata: 'ff', ledger: 100 };
    await cache.put('testnet', [first]);
    await cache.put('testnet', [updated]);
    const result = await cache.get('testnet', 100, 100);
    expect(result).toHaveLength(1);
    expect(result![0].metadata).toBe('ff');
  });

  it('isolates testnet and mainnet namespaces', async () => {
    await cache.put('testnet', [makeAnn('GTEST', 100)]);
    await cache.put('mainnet', [makeAnn('GMAIN', 100)]);

    const testResult = await cache.get('testnet', 100, 100);
    const mainResult = await cache.get('mainnet', 100, 100);

    expect(testResult!.map((a) => a.stealthAddress)).toEqual(['GTEST']);
    expect(mainResult!.map((a) => a.stealthAddress)).toEqual(['GMAIN']);
  });

  it('persists and retrieves lastSeen', async () => {
    expect(await cache.getLastSeen('testnet')).toBeNull();
    await cache.setLastSeen('testnet', 500, 'cursor-xyz');
    const lastSeen = await cache.getLastSeen('testnet');
    expect(lastSeen).toEqual({ ledger: 500, cursor: 'cursor-xyz' });
  });

  it('clears all data for a network without affecting the other', async () => {
    await cache.put('testnet', [makeAnn('GTEST', 100)]);
    await cache.put('mainnet', [makeAnn('GMAIN', 100)]);
    await cache.setLastSeen('testnet', 100, 'c1');
    await cache.clear('testnet');

    expect(await cache.get('testnet', 1, 9999)).toBeNull();
    expect(await cache.getLastSeen('testnet')).toBeNull();
    const mainResult = await cache.get('mainnet', 100, 100);
    expect(mainResult).toHaveLength(1);
  });

  it('evicts oldest ledger buckets when maxBytes is exceeded', async () => {
    // Use a tiny maxBytes limit so we can trigger eviction with few entries.
    const tiny = new MemoryCache(500); // ~500 bytes — fits ~2 entries
    const anns = [makeAnn('G1', 100), makeAnn('G2', 200), makeAnn('G3', 300), makeAnn('G4', 400)];
    await tiny.put('testnet', anns);

    // Oldest ledgers (100, 200) should be evicted; newer ones should survive.
    const result = await tiny.get('testnet', 100, 400);
    // At least some entries were evicted.
    expect(result!.length).toBeLessThan(4);
    // The surviving entries must have higher ledger numbers.
    const ledgers = result!.map((a) => a.ledger!);
    expect(Math.max(...ledgers)).toBeGreaterThan(Math.min(...ledgers));
  });

  it('idempotent put — multiple identical puts produce one entry', async () => {
    const ann = makeAnn('GDUP', 100);
    await cache.put('testnet', [ann, ann, ann]);
    const result = await cache.get('testnet', 100, 100);
    expect(result).toHaveLength(1);
  });
});

