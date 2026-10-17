import { useState, useCallback, useEffect, useRef } from 'react';
import {
  fetchAnnouncementsStream,
  type FetchAnnouncementsOptions,
  type Announcement,
} from '@wraith-protocol/sdk/chains/stellar';
import {
  getUnknownErrorMessage,
  isAbortError,
  type ScanCancellationOptions,
} from '@wraith-protocol/sdk';
import IDBCache from '../cache/idb';

/** Key under which the shared cache instance is stored on `globalThis`. */
const CACHE_KEY = '__wraith_idb_cache' as const;

type CacheGlobal = typeof globalThis & { __wraith_idb_cache?: IDBCache };

function getCache(): IDBCache {
  const global = globalThis as CacheGlobal;
  global[CACHE_KEY] ??= new IDBCache();
  return global[CACHE_KEY];
}

function abortError(): DOMException {
  return new DOMException('This operation was aborted', 'AbortError');
}

export interface UseScannerOptions extends ScanCancellationOptions {
  /**
   * Stellar deployment key to scan. React's scanner reads Stellar
   * announcements only, so the only accepted value is `stellar`.
   */
  chain?: 'stellar';
  /** Wallet address used to namespace the announcement cache. */
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
  const { chain = 'stellar', wallet = '', signal: hookSignal } = opts;
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const cache = useRef(getCache()).current;
  const mountedRef = useRef(true);
  const controllerRef = useRef<AbortController | null>(null);
  const scanIdRef = useRef(0);

  const abortActiveScan = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortActiveScan();
    };
  }, [abortActiveScan]);

  // A dependency change makes the in-flight scan stale: abort it so its
  // remainder is never applied to the next chain or wallet's state.
  useEffect(() => {
    abortActiveScan();
  }, [chain, wallet, abortActiveScan]);

  useEffect(() => {
    if (!hookSignal) return;
    if (hookSignal.aborted) {
      abortActiveScan();
      return;
    }
    hookSignal.addEventListener('abort', abortActiveScan, { once: true });
    return () => hookSignal.removeEventListener('abort', abortActiveScan);
  }, [hookSignal, abortActiveScan]);

  // Clear cache entry when wallet changes (not on chain reset — consumer calls clearCache for that)
  useEffect(() => {
    if (!wallet) return;
    (async () => {
      try {
        await cache.delete(chain, wallet);
      } catch {
        /* ignore */
      }
    })();
  }, [chain, wallet, cache]);

  const scan = useCallback(
    async (options: FetchAnnouncementsOptions = {}) => {
      abortActiveScan();

      const controller = new AbortController();
      controllerRef.current = controller;
      const scanId = ++scanIdRef.current;

      const externalSignal = options.signal;
      const forwardAbort = () => controller.abort(externalSignal?.reason);
      if (externalSignal) {
        if (externalSignal.aborted) controller.abort(externalSignal.reason);
        else externalSignal.addEventListener('abort', forwardAbort, { once: true });
      }

      const isCurrent = () => mountedRef.current && scanIdRef.current === scanId;
      const throwIfStale = () => {
        if (!isCurrent() || controller.signal.aborted) throw abortError();
      };

      setScanning(true);
      setError(null);
      try {
        throwIfStale();

        let cachedEntry: Awaited<ReturnType<IDBCache['get']>> = null;
        if (wallet) {
          try {
            cachedEntry = await cache.get(chain, wallet);
            if (cachedEntry && cachedEntry.announcements.length > 0) {
              // Show cached data immediately while fresh data loads
              if (isCurrent()) setAnnouncements(cachedEntry.announcements);
            }
          } catch {
            /* ignore cache read errors */
          }
        }

        // Resume from watermark if we have one
        const fetchOpts: FetchAnnouncementsOptions = {
          ...options,
          signal: controller.signal,
          ...(cachedEntry?.lastScannedLedger != null && options.fromLedger == null
            ? { fromLedger: cachedEntry.lastScannedLedger + 1 }
            : {}),
        };

        // Fetch fresh announcements from the watermark onwards
        const fresh: Announcement[] = [];
        for await (const announcement of fetchAnnouncementsStream(chain, fetchOpts)) {
          throwIfStale();
          fresh.push(announcement);
        }
        throwIfStale();

        // Merge cached + fresh
        const merged =
          cachedEntry && cachedEntry.announcements.length > 0
            ? [...cachedEntry.announcements, ...fresh]
            : fresh;

        setAnnouncements(merged);
        return merged;
      } catch (err) {
        if (isAbortError(err) || controller.signal.aborted || !isCurrent()) {
          throw isAbortError(err) ? err : abortError();
        }
        const failure = err instanceof Error ? err : new Error(getUnknownErrorMessage(err));
        if (isCurrent()) setError(failure);
        throw failure;
      } finally {
        externalSignal?.removeEventListener('abort', forwardAbort);
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          if (mountedRef.current) setScanning(false);
        }
      }
    },
    [chain, wallet, cache, abortActiveScan],
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
