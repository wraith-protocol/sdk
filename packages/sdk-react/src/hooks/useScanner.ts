import { useState, useCallback, useEffect, useRef } from 'react';
import {
  fetchAnnouncementsStream,
  type FetchAnnouncementsOptions,
  type Announcement,
} from '@wraith-protocol/sdk/chains/stellar';
import IDBCache from '../cache/idb';

function getCache(): IDBCache {
  const key = '__wraith_idb_cache';
  const g = globalThis as any;
  if (!g[key]) g[key] = new IDBCache();
  return g[key] as IDBCache;
}

export interface UseScannerOptions {
  chain?: string;
  wallet?: string;
}

export interface UseScannerResult {
  announcements: Announcement[];
  scanning: boolean;
  error: Error | null;
  scan: (options?: FetchAnnouncementsOptions) => Promise<Announcement[]>;
  commitScan: (lastScannedLedger?: number) => Promise<void>;
  clearCache: () => Promise<void>;
}

export function useScanner(opts: UseScannerOptions = {}): UseScannerResult {
  const { chain = 'stellar', wallet = '' } = opts;
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const cache = useRef(getCache()).current;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Clear cache entry when wallet changes (not on chain reset — consumer calls clearCache for that)
  useEffect(() => {
    if (!wallet) return;
    const m = mountedRef;
    (async () => {
      try {
        await cache.delete(chain, wallet);
      } catch {
        /* ignore */
      }
    })();
  }, [wallet]);

  const scan = useCallback(
    async (options: FetchAnnouncementsOptions = {}) => {
      setScanning(true);
      setError(null);
      try {
        let cachedEntry = null;
        if (wallet) {
          try {
            cachedEntry = await cache.get(chain, wallet);
            if (cachedEntry && cachedEntry.announcements?.length) {
              // Show cached data immediately while fresh data loads
              setAnnouncements(cachedEntry.announcements);
            }
          } catch {
            /* ignore cache read errors */
          }
        }

        // Resume from watermark if we have one
        let fetchOpts = options;
        if (cachedEntry?.lastScannedLedger != null && options.fromLedger == null) {
          fetchOpts = { ...options, fromLedger: cachedEntry.lastScannedLedger + 1 };
        }

        // Fetch fresh announcements from the watermark onwards
        const fresh: Announcement[] = [];
        for await (const ann of fetchAnnouncementsStream(chain, fetchOpts as any)) {
          fresh.push(ann as Announcement);
        }

        // Merge cached + fresh
        const merged =
          cachedEntry && cachedEntry.announcements?.length
            ? [...cachedEntry.announcements, ...fresh]
            : fresh;

        if (mountedRef.current) {
          setAnnouncements(merged);
        }
        return merged;
      } catch (err: any) {
        if (mountedRef.current) setError(err);
        throw err;
      } finally {
        if (mountedRef.current) setScanning(false);
      }
    },
    [chain, wallet, cache],
  );

  const commitScan = useCallback(
    async (lastScannedLedger?: number) => {
      if (!wallet) return;
      try {
        await cache.commit(chain, wallet, announcements, lastScannedLedger);
      } catch {
        /* ignore commit errors */
      }
    },
    [chain, wallet, announcements, cache],
  );

  const clearCache = useCallback(async () => {
    try {
      await cache.clearChain(chain);
      if (mountedRef.current) setAnnouncements([]);
    } catch {
      /* ignore */
    }
  }, [chain, cache]);

  return { announcements, scanning, error, scan, commitScan, clearCache };
}
