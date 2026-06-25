import type { Announcement, Network } from './types';

/** Current cache schema version. Bump to force a full rebuild on schema changes. */
const CACHE_VERSION = 1;

/** Maximum byte budget for IndexedDBCache before LRU eviction. */
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

const DB_NAME = 'wraith-stellar-cache';
const STORE_ANN = 'announcements';
const STORE_META = 'meta';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface AnnouncementCache {
  /**
   * Returns all cached announcements whose ledger falls within [fromLedger, toLedger].
   * Returns null when no data is cached for this network/range (caller should fetch from RPC).
   */
  get(network: Network, fromLedger: number, toLedger: number): Promise<Announcement[] | null>;

  /**
   * Merges new announcements into the cache for the given network.
   * Deduplicates by stealthAddress.
   */
  put(network: Network, announcements: Announcement[]): Promise<void>;

  /** Returns the highest ledger and its cursor seen for this network, or null. */
  getLastSeen(network: Network): Promise<{ ledger: number; cursor: string } | null>;

  /** Persists the highest seen ledger + cursor for this network. */
  setLastSeen(network: Network, ledger: number, cursor: string): Promise<void>;

  /** Drops all cached data for the given network. */
  clear(network: Network): Promise<void>;
}

// ---------------------------------------------------------------------------
// MemoryCache — LRU in-memory, default for Node / RN / server
// ---------------------------------------------------------------------------

/**
 * In-memory announcement cache backed by a flat per-network Map.
 * Entries are keyed by `stealthAddress` for deduplication.
 * Eviction is byte-approximate: removes oldest ledger buckets first when
 * the estimated byte size exceeds `maxBytes`.
 */
export class MemoryCache implements AnnouncementCache {
  /** network → (stealthAddress → Announcement) */
  private readonly store = new Map<Network, Map<string, Announcement>>();
  /** network → { ledger, cursor } */
  private readonly lastSeen = new Map<Network, { ledger: number; cursor: string }>();
  private readonly maxBytes: number;

  constructor(maxBytes = MAX_BYTES) {
    this.maxBytes = maxBytes;
  }

  async get(network: Network, fromLedger: number, toLedger: number): Promise<Announcement[] | null> {
    const ns = this.store.get(network);
    if (!ns || ns.size === 0) return null;
    const results = [...ns.values()].filter(
      (a) => a.ledger !== undefined && a.ledger >= fromLedger && a.ledger <= toLedger,
    );
    return results.length === 0 ? null : results;
  }

  async put(network: Network, announcements: Announcement[]): Promise<void> {
    if (announcements.length === 0) return;
    let ns = this.store.get(network);
    if (!ns) {
      ns = new Map();
      this.store.set(network, ns);
    }
    for (const ann of announcements) {
      ns.set(ann.stealthAddress, ann);
    }
    this.evict(network);
  }

  async getLastSeen(network: Network): Promise<{ ledger: number; cursor: string } | null> {
    return this.lastSeen.get(network) ?? null;
  }

  async setLastSeen(network: Network, ledger: number, cursor: string): Promise<void> {
    this.lastSeen.set(network, { ledger, cursor });
  }

  async clear(network: Network): Promise<void> {
    this.store.delete(network);
    this.lastSeen.delete(network);
  }

  private evict(network: Network): void {
    const ns = this.store.get(network);
    if (!ns) return;
    const rough = roughBytes(ns);
    if (rough <= this.maxBytes) return;

    // Group by ledger, evict oldest first.
    const byLedger = new Map<number, string[]>();
    for (const [key, ann] of ns) {
      const l = ann.ledger ?? 0;
      let bucket = byLedger.get(l);
      if (!bucket) {
        bucket = [];
        byLedger.set(l, bucket);
      }
      bucket.push(key);
    }

    const ledgers = [...byLedger.keys()].sort((a, b) => a - b);
    let current = rough;
    for (const ledger of ledgers) {
      if (current <= this.maxBytes) break;
      for (const key of byLedger.get(ledger)!) {
        const ann = ns.get(key)!;
        current -= roughBytesForEntry(ann);
        ns.delete(key);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// IndexedDBCache — persistent browser cache
// ---------------------------------------------------------------------------

/**
 * Persistent announcement cache backed by IndexedDB.
 * Schema version is stored in the `meta` store; a version mismatch drops
 * and rebuilds the entire database.
 *
 * All writes within a single `put()` call share one IDBTransaction so the
 * browser never sees thousands of individual puts.
 */
export class IndexedDBCache implements AnnouncementCache {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly maxBytes: number;

  constructor(maxBytes = MAX_BYTES) {
    this.maxBytes = maxBytes;
  }

  private openDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, CACHE_VERSION);

      req.onupgradeneeded = (evt) => {
        const db = (evt.target as IDBOpenDBRequest).result;
        // Drop stale stores on version bump.
        if (db.objectStoreNames.contains(STORE_ANN)) db.deleteObjectStore(STORE_ANN);
        if (db.objectStoreNames.contains(STORE_META)) db.deleteObjectStore(STORE_META);

        const annStore = db.createObjectStore(STORE_ANN, { keyPath: '_key' });
        annStore.createIndex('network_ledger', ['network', 'ledger'], { unique: false });
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  async get(network: Network, fromLedger: number, toLedger: number): Promise<Announcement[] | null> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ANN, 'readonly');
      const store = tx.objectStore(STORE_ANN);
      const index = store.index('network_ledger');
      const range = IDBKeyRange.bound([network, fromLedger], [network, toLedger]);
      const req = index.getAll(range);
      req.onsuccess = () => {
        const rows: StoredAnnouncement[] = req.result;
        if (rows.length === 0) {
          resolve(null);
          return;
        }
        resolve(rows.map(({ _key: _k, network: _n, ...ann }) => ann as Announcement));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async put(network: Network, announcements: Announcement[]): Promise<void> {
    if (announcements.length === 0) return;
    const db = await this.openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_ANN, 'readwrite');
      const store = tx.objectStore(STORE_ANN);
      for (const ann of announcements) {
        const record: StoredAnnouncement = {
          ...ann,
          _key: `${network}:${ann.stealthAddress}`,
          network,
          _bytes: roughBytesForEntry(ann),
        };
        store.put(record);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    await this.evict();
  }

  private async evict(): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ANN, 'readwrite');
      const store = tx.objectStore(STORE_ANN);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      const req = store.getAll();
      req.onsuccess = () => {
        const all: StoredAnnouncement[] = req.result;
        const totalBytes = all.reduce((s, r) => s + (r._bytes ?? 0), 0);
        if (totalBytes <= this.maxBytes) return;
        // Evict oldest ledgers first (LRU by ledger sequence).
        const sorted = all.slice().sort((a, b) => (a.ledger ?? 0) - (b.ledger ?? 0));
        let remaining = totalBytes;
        let i = 0;
        const step = () => {
          if (remaining <= this.maxBytes || i >= sorted.length) return;
          const rec = sorted[i++];
          remaining -= rec._bytes ?? 0;
          const delReq = store.delete(rec._key);
          delReq.onsuccess = step;
          delReq.onerror = () => reject(delReq.error);
        };
        step();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getLastSeen(network: Network): Promise<{ ledger: number; cursor: string } | null> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const store = tx.objectStore(STORE_META);
      const req = store.get(`lastSeen:${network}`);
      req.onsuccess = () => resolve(req.result?.value ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async setLastSeen(network: Network, ledger: number, cursor: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      const store = tx.objectStore(STORE_META);
      store.put({ key: `lastSeen:${network}`, value: { ledger, cursor } });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clear(network: Network): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_ANN, STORE_META], 'readwrite');
      const annStore = tx.objectStore(STORE_ANN);
      const metaStore = tx.objectStore(STORE_META);

      // Delete all announcements for this network via the index.
      const index = annStore.index('network_ledger');
      const range = IDBKeyRange.bound([network, 0], [network, Number.MAX_SAFE_INTEGER]);
      const cursorReq = index.openCursor(range);
      cursorReq.onsuccess = (evt) => {
        const cursor = (evt.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      metaStore.delete(`lastSeen:${network}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

// ---------------------------------------------------------------------------
// Auto-selection
// ---------------------------------------------------------------------------

/**
 * Returns an `IndexedDBCache` when running in a browser environment (IndexedDB
 * is available), otherwise returns a `MemoryCache`.
 */
export function autoSelectCache(): AnnouncementCache {
  if ('indexedDB' in (globalThis as Record<string, unknown>)) {
    return new IndexedDBCache();
  }
  return new MemoryCache();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface StoredAnnouncement extends Announcement {
  /** Composite key: `"${network}:${stealthAddress}"` */
  _key: string;
  network: Network;
  /** Rough byte estimate for this entry — used for 50 MB eviction budget. */
  _bytes: number;
}

function roughBytesForEntry(ann: Announcement): number {
  // Rough UTF-16 estimate: 2 bytes per char + overhead per field.
  return (
    (ann.stealthAddress.length +
      ann.caller.length +
      ann.ephemeralPubKey.length +
      ann.metadata.length) *
      2 +
    64
  );
}

function roughBytes(ns: Map<string, Announcement>): number {
  let total = 0;
  for (const ann of ns.values()) total += roughBytesForEntry(ann);
  return total;
}
