import type { Announcement } from '@wraith-protocol/sdk/chains/stellar';

type CacheEntry = {
  id: string;
  chain: string;
  wallet: string;
  announcements: Announcement[];
  lastAccess: number;
  lastUpdated: number;
  lastScannedLedger?: number;
};

export interface IDBCacheOptions {
  dbName?: string;
  storeName?: string;
  maxEntries?: number;
}

function makeId(chain: string, wallet: string) {
  return `${chain}:${wallet}`;
}

class MemoryCache {
  private map = new Map<string, CacheEntry>();
  constructor(private maxEntries: number) {}

  async get(chain: string, wallet: string) {
    const id = makeId(chain, wallet);
    const e = this.map.get(id) ?? null;
    if (!e) return null;
    e.lastAccess = Date.now();
    this.map.set(id, e);
    return e;
  }

  async set(chain: string, wallet: string, announcements: Announcement[]) {
    const id = makeId(chain, wallet);
    const entry: CacheEntry = {
      id,
      chain,
      wallet,
      announcements,
      lastAccess: Date.now(),
      lastUpdated: Date.now(),
    };
    this.map.set(id, entry);
    await this.enforceCap();
    return entry;
  }

  /** Atomically set announcements and advance watermark (lastScannedLedger) */
  async commit(
    chain: string,
    wallet: string,
    announcements: Announcement[],
    lastScannedLedger?: number,
  ) {
    await this.readyCheck();
    if (this.fallback) {
      const e = await this.fallback.set(chain, wallet, announcements);
      if (lastScannedLedger) e.lastScannedLedger = lastScannedLedger;
      return e;
    }
    if (!this.db) return null;
    const id = makeId(chain, wallet);
    const entry: CacheEntry = {
      id,
      chain,
      wallet,
      announcements,
      lastAccess: Date.now(),
      lastUpdated: Date.now(),
      lastScannedLedger,
    };
    return new Promise<CacheEntry>((resolve, reject) => {
      const tx = this.db!.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const req = store.put(entry);
      req.onsuccess = async () => {
        await this.enforceCap();
        resolve(entry);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async delete(chain: string, wallet: string) {
    this.map.delete(makeId(chain, wallet));
  }

  async clearChain(chain: string) {
    for (const key of Array.from(this.map.keys())) {
      if (key.startsWith(`${chain}:`)) this.map.delete(key);
    }
  }

  async keys() {
    return Array.from(this.map.keys());
  }

  private async enforceCap(maxEntries = 100) {
    const keys = Array.from(this.map.keys());
    if (keys.length <= maxEntries) return;
    const entries = Array.from(this.map.values()).sort((a, b) => a.lastAccess - b.lastAccess);
    const toRemove = entries.slice(0, keys.length - maxEntries);
    for (const r of toRemove) this.map.delete(r.id);
  }
}

export class IDBCache {
  private db: IDBDatabase | null = null;
  private ready: Promise<void> | null = null;
  private fallback: MemoryCache | null = null;
  private dbName: string;
  private storeName: string;
  private maxEntries: number;

  constructor(opts: IDBCacheOptions = {}) {
    this.dbName = opts.dbName ?? 'wraith-sdk-cache-v1';
    this.storeName = opts.storeName ?? 'caches';
    this.maxEntries = opts.maxEntries ?? 200;
    this.ready = this.init();
  }

  private async init() {
    if (typeof indexedDB === 'undefined') {
      this.fallback = new MemoryCache(this.maxEntries);
      return;
    }

    return new Promise<void>((resolve) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const s = db.createObjectStore(this.storeName, { keyPath: 'id' });
          s.createIndex('lastAccess', 'lastAccess');
          s.createIndex('chain', 'chain');
          s.createIndex('wallet', 'wallet');
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve();
      };
      req.onerror = () => {
        // Fallback to memory store on error
        this.fallback = new MemoryCache(this.maxEntries);
        resolve();
      };
    });
  }

  private async readyCheck() {
    if (this.ready) await this.ready;
  }

  async get(chain: string, wallet: string) {
    await this.readyCheck();
    if (this.fallback) return this.fallback.get(chain, wallet);
    if (!this.db) return null;
    return new Promise<CacheEntry | null>((resolve, reject) => {
      const tx = this.db!.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const id = makeId(chain, wallet);
      const req = store.get(id);
      req.onsuccess = () => {
        const val = req.result as CacheEntry | undefined;
        if (!val) return resolve(null);
        val.lastAccess = Date.now();
        store.put(val);
        resolve(val);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async set(chain: string, wallet: string, announcements: Announcement[]) {
    await this.readyCheck();
    if (this.fallback) return this.fallback.set(chain, wallet, announcements);
    if (!this.db) return null;
    const id = makeId(chain, wallet);
    const entry: CacheEntry = {
      id,
      chain,
      wallet,
      announcements,
      lastAccess: Date.now(),
      lastUpdated: Date.now(),
    };
    return new Promise<CacheEntry>((resolve, reject) => {
      const tx = this.db!.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const req = store.put(entry);
      req.onsuccess = async () => {
        await this.enforceCap();
        resolve(entry);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async delete(chain: string, wallet: string) {
    await this.readyCheck();
    if (this.fallback) return this.fallback.delete(chain, wallet);
    if (!this.db) return;
    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const id = makeId(chain, wallet);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async commit(
    chain: string,
    wallet: string,
    announcements: Announcement[],
    lastScannedLedger?: number,
  ) {
    await this.readyCheck();
    if (this.fallback) {
      const e = await this.fallback.set(chain, wallet, announcements);
      if (lastScannedLedger != null) e.lastScannedLedger = lastScannedLedger;
      return e;
    }
    if (!this.db) return null;
    const id = makeId(chain, wallet);
    const entry: CacheEntry = {
      id,
      chain,
      wallet,
      announcements,
      lastAccess: Date.now(),
      lastUpdated: Date.now(),
      lastScannedLedger,
    };
    return new Promise<CacheEntry>((resolve, reject) => {
      const tx = this.db!.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const req = store.put(entry);
      req.onsuccess = async () => {
        await this.enforceCap();
        resolve(entry);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async clearChain(chain: string) {
    await this.readyCheck();
    if (this.fallback) return this.fallback.clearChain(chain);
    if (!this.db) return;
    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const idx = store.index('chain');
      const req = idx.openCursor(IDBKeyRange.only(chain));
      req.onsuccess = (ev) => {
        const cur = (ev.target as IDBRequest).result as IDBCursorWithValue | null;
        if (!cur) return resolve();
        cur.delete();
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  private async enforceCap() {
    if (this.fallback) return; // memory handles its own cap
    if (!this.db) return;
    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result as CacheEntry[];
        if (all.length <= this.maxEntries) return resolve();
        const toRemove = all
          .sort((a, b) => a.lastAccess - b.lastAccess)
          .slice(0, all.length - this.maxEntries);
        let count = toRemove.length;
        for (const r of toRemove) {
          const dreq = store.delete(r.id);
          dreq.onsuccess = () => {
            count -= 1;
            if (count === 0) resolve();
          };
          dreq.onerror = () => {
            /* ignore individual errors */
            count -= 1;
            if (count === 0) resolve();
          };
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async keys() {
    await this.readyCheck();
    if (this.fallback) return this.fallback.keys();
    if (!this.db) return [];
    return new Promise<string[]>((resolve, reject) => {
      const tx = this.db!.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result as string[]);
      req.onerror = () => reject(req.error);
    });
  }
}

export default IDBCache;
