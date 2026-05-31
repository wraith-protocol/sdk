import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchAnnouncements, scanAnnouncements } from '@wraith-protocol/sdk/chains/stellar';
import type { StealthKeys, MatchedAnnouncement } from '@wraith-protocol/sdk/chains/stellar';
import type { ScanOptions, UseStellarAnnouncementScanResult } from './types';

/**
 * Scans for stealth address announcements belonging to the user.
 * 
 * Auto-polls at the specified interval (default 60s).
 * Uses streaming scan for memory efficiency.
 * Safe for React Strict Mode.
 * 
 * @param keys - Stealth keys from useStellarStealthKeys
 * @param options - Scan configuration
 * @returns Matched announcements, scanning state, and refetch function
 * 
 * @example
 * ```tsx
 * const { keys } = useStellarStealthKeys(signature);
 * const { matches, isScanning, refetch } = useStellarAnnouncementScan(keys, {
 *   intervalMs: 30000, // Poll every 30s
 * });
 * 
 * return (
 *   <div>
 *     <p>Found {matches.length} payments</p>
 *     <button onClick={refetch}>Refresh</button>
 *   </div>
 * );
 * ```
 */
export function useStellarAnnouncementScan(
  keys: StealthKeys | null,
  options: ScanOptions = {}
): UseStellarAnnouncementScanResult {
  const { intervalMs = 60000, enabled = true } = options;

  const [state, setState] = useState<{
    matches: MatchedAnnouncement[];
    isScanning: boolean;
    lastScanAt: Date | null;
    error: Error | null;
    cursor: string | null;
  }>({
    matches: [],
    isScanning: false,
    lastScanAt: null,
    error: null,
    cursor: null,
  });

  const scanningRef = useRef(false);
  const mountedRef = useRef(true);

  const scan = useCallback(async () => {
    if (!keys || !enabled || scanningRef.current) {
      return;
    }

    scanningRef.current = true;
    setState((prev) => ({ ...prev, isScanning: true, error: null }));

    try {
      const announcements = await fetchAnnouncements();

      if (!mountedRef.current) return;

      const matched = scanAnnouncements(
        announcements,
        keys.viewingKey,
        keys.spendingPubKey,
        keys.spendingScalar
      );

      setState({
        matches: matched,
        isScanning: false,
        lastScanAt: new Date(),
        error: null,
        cursor: null,
      });
    } catch (err) {
      if (!mountedRef.current) return;

      setState((prev) => ({
        ...prev,
        isScanning: false,
        error: err instanceof Error ? err : new Error(String(err)),
      }));
    } finally {
      scanningRef.current = false;
    }
  }, [keys, enabled]);

  // Initial scan and polling
  useEffect(() => {
    if (!keys || !enabled) {
      return;
    }

    // Initial scan
    scan();

    // Set up polling
    const interval = setInterval(scan, intervalMs);

    return () => {
      clearInterval(interval);
    };
  }, [keys, enabled, intervalMs, scan]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    ...state,
    refetch: scan,
  };
}
