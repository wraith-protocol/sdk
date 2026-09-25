import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { IndexedDBCache, CacheQuotaError } from '../../../src/chains/stellar/cache';
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

/** The DB name IndexedDBCache uses internally. */
const DB_NAME = 'wraith-stellar-cache';

// ---------------------------------------------------------------------------
// IndexedDBCache unit tests
// ---------------------------------------------------------------------------

describe('IndexedDBCache', () => {
  beforeEach(() => {
    // Fresh in-memory IDB instance per test — guarantees full isolation.
    const g = globalThis as unknown as Record<string, unknown>;
    g['indexedDB'] = new IDBFactory();
    g['IDBKeyRange'] = IDBKeyRange;
  });

  it('returns null for an empty network', async () => {
    const cache = new IndexedDBCache();
    expect(await cache.get('testnet', 1, 1000)).toBeNull();
  });

  it('returns null when no announcements match the ledger range', async () => {
    const cache = new IndexedDBCache();
    await cache.put('testnet', [makeAnn('GFOO', 200)]);
    expect(await cache.get('testnet', 500, 600)).toBeNull();
  });

  it('stores and retrieves announcements by ledger range', async () => {
    const cache = new IndexedDBCache();
    await cache.put('testnet', [makeAnn('GAAA', 100), makeAnn('GBBB', 200), makeAnn('GCCC', 300)]);
    const result = await cache.get('testnet', 100, 200);
    expect(result).toHaveLength(2);
    expect(result!.map((a) => a.stealthAddress).sort()).toEqual(['GAAA', 'GBBB'].sort());
  });

  it('deduplicates by stealthAddress on repeated puts', async () => {
    const cache = new IndexedDBCache();
    const first = makeAnn('GAAA', 100);
    await cache.put('testnet', [first]);
    await cache.put('testnet', [{ ...first, metadata: 'ff' }]);
    const result = await cache.get('testnet', 100, 100);
    expect(result).toHaveLength(1);
    expect(result![0].metadata).toBe('ff');
  });

  it('isolates testnet and mainnet namespaces', async () => {
    const cache = new IndexedDBCache();
    await cache.put('testnet', [makeAnn('GTEST', 100)]);
    await cache.put('mainnet', [makeAnn('GMAIN', 100)]);
    expect((await cache.get('testnet', 100, 100))!.map((a) => a.stealthAddress)).toEqual(['GTEST']);
    expect((await cache.get('mainnet', 100, 100))!.map((a) => a.stealthAddress)).toEqual(['GMAIN']);
  });

  it('persists and retrieves lastSeen', async () => {
    const cache = new IndexedDBCache();
    expect(await cache.getLastSeen('testnet')).toBeNull();
    await cache.setLastSeen('testnet', 500, 'cursor-xyz');
    expect(await cache.getLastSeen('testnet')).toEqual({ ledger: 500, cursor: 'cursor-xyz' });
  });

  it('clears all data for a network without affecting the other', async () => {
    const cache = new IndexedDBCache();
    await cache.put('testnet', [makeAnn('GTEST', 100)]);
    await cache.put('mainnet', [makeAnn('GMAIN', 100)]);
    await cache.setLastSeen('testnet', 100, 'c1');
    await cache.clear('testnet');
    expect(await cache.get('testnet', 1, 9999)).toBeNull();
    expect(await cache.getLastSeen('testnet')).toBeNull();
    expect(await cache.get('mainnet', 100, 100)).toHaveLength(1);
  });

  it('evicts oldest ledger entries when maxBytes is exceeded', async () => {
    // Each entry is ~214 bytes; 500 bytes fits ~2 entries.
    const cache = new IndexedDBCache(500);
    await cache.put('testnet', [
      makeAnn('G1', 100),
      makeAnn('G2', 200),
      makeAnn('G3', 300),
      makeAnn('G4', 400),
    ]);
    const result = await cache.get('testnet', 100, 400);
    expect(result!.length).toBeLessThan(4);
    // Surviving entries must span more than one ledger (oldest were evicted).
    const ledgers = result!.map((a) => a.ledger!);
    expect(Math.max(...ledgers)).toBeGreaterThan(Math.min(...ledgers));
  });

  // -------------------------------------------------------------------------
  // Version migration
  // -------------------------------------------------------------------------

  it('migrates safely without dropping data when schema version bumps', async () => {
    const idb = (globalThis as unknown as Record<string, unknown>)['indexedDB'] as IDBFactory;

    // Phase 1 — seed the DB manually to simulate an older version or previous install
    await new Promise<void>((resolve, reject) => {
      // Simulate what the DB looked like before, or just use the current IndexedDBCache
      const req = idb.open(DB_NAME, 1);
      req.onupgradeneeded = (evt) => {
        const db = (evt.target as IDBOpenDBRequest).result;
        const ann = db.createObjectStore('announcements', { keyPath: '_key' });
        ann.createIndex('network_ledger', ['network', 'ledger'], { unique: false });
        db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['announcements', 'meta'], 'readwrite');
        tx.objectStore('announcements').put({
          _key: 'testnet:GFOO',
          network: 'testnet',
          stealthAddress: 'GFOO',
          schemeId: 1,
          caller: 'GCALLER',
          ephemeralPubKey: '00'.repeat(32),
          metadata: '01',
          ledger: 100,
          _bytes: 200,
        });
        tx.objectStore('meta').put({
          key: 'lastSeen:testnet',
          value: { ledger: 100, cursor: 'c1' },
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    // Phase 2 — Use IndexedDBCache to open the DB
    // Since IndexedDBCache now uses conditional creation, it should NOT drop data.
    const cache = new IndexedDBCache();
    const result = await cache.get('testnet', 100, 100);
    expect(result).toHaveLength(1);
    expect(result![0].stealthAddress).toBe('GFOO');

    const lastSeen = await cache.getLastSeen('testnet');
    expect(lastSeen).toEqual({ ledger: 100, cursor: 'c1' });
  });

  // -------------------------------------------------------------------------
  // Quota and Recovery
  // -------------------------------------------------------------------------

  it('handles QuotaExceededError with bounded eviction and preserves lastSeen', async () => {
    const cache = new IndexedDBCache(1000);
    await cache.put('testnet', [makeAnn('G1', 100), makeAnn('G2', 200)]);
    await cache.setLastSeen('testnet', 200, 'cursor-2');

    // Get the IDBObjectStore prototype dynamically
    const idb = (globalThis as unknown as Record<string, unknown>)['indexedDB'] as IDBFactory;
    let storeProto: any;
    await new Promise<void>((resolve) => {
      const req = idb.open('dummy-for-proto', 1);
      req.onupgradeneeded = (e: any) => {
        const store = e.target.result.createObjectStore('dummy');
        storeProto = Object.getPrototypeOf(store);
      };
      req.onsuccess = () => resolve();
    });

    const origPut = storeProto.put;
    let thrown = false;
    storeProto.put = function (this: any, value: any, key: any) {
      if (!thrown && value && (value as any).stealthAddress === 'G3') {
        thrown = true;
        const err = new DOMException('QuotaExceededError', 'QuotaExceededError');
        throw err;
      }
      return origPut.call(this, value, key);
    };

    try {
      await cache.put('testnet', [makeAnn('G3', 300)]);
    } catch (e: any) {
      // should not throw out, it should recover
    } finally {
      storeProto.put = origPut;
    }

    // Verify it succeeded in saving G3
    const result = await cache.get('testnet', 100, 300);
    expect(result?.find((a) => a.stealthAddress === 'G3')).toBeDefined();
    // lastSeen should be preserved
    expect(await cache.getLastSeen('testnet')).toEqual({ ledger: 200, cursor: 'cursor-2' });
  });

  it('throws CacheQuotaError if QuotaExceededError persists after eviction', async () => {
    const cache = new IndexedDBCache(1000);

    const idb = (globalThis as unknown as Record<string, unknown>)['indexedDB'] as IDBFactory;
    let storeProto: any;
    await new Promise<void>((resolve) => {
      const req = idb.open('dummy-for-proto-2', 1);
      req.onupgradeneeded = (e: any) => {
        const store = e.target.result.createObjectStore('dummy');
        storeProto = Object.getPrototypeOf(store);
      };
      req.onsuccess = () => resolve();
    });

    const origPut = storeProto.put;
    storeProto.put = function (this: any, value: any, key: any) {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    };

    await expect(cache.put('testnet', [makeAnn('G4', 400)])).rejects.toThrow(CacheQuotaError);

    storeProto.put = origPut;
  });
});
