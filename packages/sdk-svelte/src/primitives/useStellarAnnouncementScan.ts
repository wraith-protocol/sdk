import { readonly, writable } from 'svelte/store';
import {
  fetchAnnouncementsStream,
  type Announcement,
  type FetchAnnouncementsOptions,
} from '@wraith-protocol/sdk/chains/stellar';

/** Store primitive for scanning Stellar stealth announcements. */
export function useStellarAnnouncementScan() {
  const _announcements = writable<Announcement[]>([]);
  const _scanning = writable(false);
  const _error = writable<Error | null>(null);

  async function scan(options: FetchAnnouncementsOptions): Promise<Announcement[]> {
    _scanning.set(true);
    _error.set(null);

    try {
      const announcements: Announcement[] = [];
      for await (const announcement of fetchAnnouncementsStream('stellar', options)) {
        announcements.push(announcement);
      }
      _announcements.set(announcements);
      return announcements;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      _error.set(error);
      throw cause;
    } finally {
      _scanning.set(false);
    }
  }

  return {
    announcements: readonly(_announcements),
    scanning: readonly(_scanning),
    error: readonly(_error),
    scan,
  };
}
