import { createSignal } from 'solid-js';
import {
  fetchAnnouncementsStream,
  scanAnnouncements as stellarScanAnnouncements,
  type FetchAnnouncementsOptions,
  type Announcement,
  type MatchedAnnouncement,
} from '@wraith-protocol/sdk/chains/stellar';

/**
 * Solid primitive for scanning Stellar stealth payment announcements.
 *
 * Handles fetch + scan lifecycle with reactive loading/error signals.
 * All reactive values are returned as getter functions following Solid conventions.
 */
export function createScanner() {
  const [announcements, setAnnouncements] = createSignal<Announcement[]>([]);
  const [matched, setMatched] = createSignal<MatchedAnnouncement[]>([]);
  const [scanning, setScanning] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);

  /**
   * Fetch raw announcements from the Stellar network using the streaming RPC.
   * Collects all pages into a local array then updates the signal.
   */
  async function scan(
    chain = 'stellar',
    opts?: FetchAnnouncementsOptions,
  ): Promise<Announcement[]> {
    setScanning(true);
    setError(null);
    try {
      const collected: Announcement[] = [];
      for await (const announcement of fetchAnnouncementsStream(chain, opts)) {
        collected.push(announcement);
      }
      setAnnouncements(collected);
      return collected;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setScanning(false);
    }
  }

  /**
   * Filter a list of announcements for ones that belong to the given keys.
   */
  function match(
    announcementsList: Announcement[],
    viewingKey: Uint8Array,
    spendingPubKey: Uint8Array,
    spendingScalar: bigint,
  ): MatchedAnnouncement[] {
    setError(null);
    try {
      const result = stellarScanAnnouncements(
        announcementsList,
        viewingKey,
        spendingPubKey,
        spendingScalar,
      );
      setMatched(() => result);
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    }
  }

  /**
   * Fetch then match in one call.
   */
  async function scanAndMatch(
    viewingKey: Uint8Array,
    spendingPubKey: Uint8Array,
    spendingScalar: bigint,
    chain = 'stellar',
    opts?: FetchAnnouncementsOptions,
  ): Promise<MatchedAnnouncement[]> {
    const list = await scan(chain, opts);
    return match(list, viewingKey, spendingPubKey, spendingScalar);
  }

  return {
    // Reactive getters (Solid signal accessors)
    announcements,
    matched,
    scanning,
    error,
    // Actions
    scan,
    match,
    scanAndMatch,
  };
}
