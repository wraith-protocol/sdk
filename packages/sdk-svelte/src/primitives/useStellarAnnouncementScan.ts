import { readonly, writable } from 'svelte/store';
import {
  fetchAnnouncementsStream,
  type Announcement,
  type FetchAnnouncementsOptions,
} from '@wraith-protocol/sdk/chains/stellar';
import {
  getUnknownErrorMessage,
  isAbortError,
  type ScanCancellationOptions,
} from '@wraith-protocol/sdk';

export interface StellarAnnouncementScanOptions extends ScanCancellationOptions {}

function abortError(): DOMException {
  return new DOMException('This operation was aborted', 'AbortError');
}

/**
 * Store primitive for scanning Stellar stealth announcements.
 *
 * Pass a `signal` (for example from a component's `onDestroy`) to cancel scans
 * with the component. { scan } also accepts its own `signal`, aborts any scan
 * already in flight, and never publishes a result that has been superseded.
 */
export function useStellarAnnouncementScan(options: StellarAnnouncementScanOptions = {}) {
  const _announcements = writable<Announcement[]>([]);
  const _scanning = writable(false);
  const _error = writable<Error | null>(null);

  let activeController: AbortController | null = null;
  let scanId = 0;
  let disposed = false;

  function abortActive(): void {
    activeController?.abort();
    activeController = null;
  }

  function dispose(): void {
    disposed = true;
    abortActive();
  }

  if (options.signal) {
    if (options.signal.aborted) dispose();
    else options.signal.addEventListener('abort', dispose, { once: true });
  }

  async function scan(scanOptions: FetchAnnouncementsOptions = {}): Promise<Announcement[]> {
    if (disposed) throw abortError();

    abortActive();
    const controller = new AbortController();
    activeController = controller;
    const currentScan = ++scanId;

    const externalSignal = scanOptions.signal;
    const forwardAbort = () => controller.abort(externalSignal?.reason);
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort(externalSignal.reason);
      else externalSignal.addEventListener('abort', forwardAbort, { once: true });
    }

    const isCurrent = () => !disposed && currentScan === scanId && !controller.signal.aborted;

    _scanning.set(true);
    _error.set(null);

    try {
      const announcements: Announcement[] = [];
      for await (const announcement of fetchAnnouncementsStream('stellar', {
        ...scanOptions,
        signal: controller.signal,
      })) {
        if (!isCurrent()) throw abortError();
        announcements.push(announcement);
      }

      if (!isCurrent()) throw abortError();
      _announcements.set(announcements);
      return announcements;
    } catch (cause) {
      if (isAbortError(cause) || !isCurrent()) {
        throw isAbortError(cause) ? cause : abortError();
      }
      _error.set(cause instanceof Error ? cause : new Error(getUnknownErrorMessage(cause)));
      throw cause;
    } finally {
      externalSignal?.removeEventListener('abort', forwardAbort);
      if (activeController === controller) {
        activeController = null;
        if (!disposed) _scanning.set(false);
      }
    }
  }

  return {
    announcements: readonly(_announcements),
    scanning: readonly(_scanning),
    error: readonly(_error),
    scan,
    dispose,
  };
}
