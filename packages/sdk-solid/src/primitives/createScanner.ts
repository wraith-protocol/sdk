import { createSignal, getOwner, onCleanup } from 'solid-js';
import {
  fetchAnnouncementsStream,
  scanAnnouncements as stellarScanAnnouncements,
  type FetchAnnouncementsOptions,
  type Announcement,
  type MatchedAnnouncement,
} from '@wraith-protocol/sdk/chains/stellar';
import {
  getUnknownErrorMessage,
  isAbortError,
  type ScanCancellationOptions,
} from '@wraith-protocol/sdk';

export interface CreateScannerOptions extends ScanCancellationOptions {}

function abortError(): DOMException {
  return new DOMException('This operation was aborted', 'AbortError');
}

/**
 * Solid primitive for scanning Stellar stealth payment announcements.
 *
 * Handles fetch + scan lifecycle with reactive loading/error signals.
 * All reactive values are returned as getter functions following Solid conventions.
 *
 * The primitive aborts its in-flight scan when the owning root or component is
 * disposed. `scan` also accepts one `signal`, aborts any scan already in
 * flight, and never publishes a superseded result.
 */
export function createScanner(options: CreateScannerOptions = {}) {
  const [announcements, setAnnouncements] = createSignal<Announcement[]>([]);
  const [matched, setMatched] = createSignal<MatchedAnnouncement[]>([]);
  const [scanning, setScanning] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);

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

  // `onCleanup` is a no-op without an owner, so only register inside a root or
  // component to avoid Solid's "cleanups created outside createRoot" warning.
  if (getOwner()) onCleanup(dispose);

  if (options.signal) {
    if (options.signal.aborted) dispose();
    else options.signal.addEventListener('abort', dispose, { once: true });
  }

  /**
   * Fetch raw announcements from the Stellar network using the streaming RPC.
   * Collects all pages into a local array then updates the signal.
   */
  async function scan(
    chain = 'stellar',
    opts: FetchAnnouncementsOptions = {},
  ): Promise<Announcement[]> {
    if (disposed) throw abortError();

    abortActive();
    const controller = new AbortController();
    activeController = controller;
    const currentScan = ++scanId;

    const externalSignal = opts.signal;
    const forwardAbort = () => controller.abort(externalSignal?.reason);
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort(externalSignal.reason);
      else externalSignal.addEventListener('abort', forwardAbort, { once: true });
    }

    const isCurrent = () => !disposed && currentScan === scanId && !controller.signal.aborted;

    setScanning(true);
    setError(null);

    try {
      const collected: Announcement[] = [];
      for await (const announcement of fetchAnnouncementsStream(chain, {
        ...opts,
        signal: controller.signal,
      })) {
        if (!isCurrent()) throw abortError();
        collected.push(announcement);
      }

      if (!isCurrent()) throw abortError();
      setAnnouncements(collected);
      return collected;
    } catch (cause) {
      if (isAbortError(cause) || !isCurrent()) {
        throw isAbortError(cause) ? cause : abortError();
      }
      setError(cause instanceof Error ? cause : new Error(getUnknownErrorMessage(cause)));
      throw cause;
    } finally {
      externalSignal?.removeEventListener('abort', forwardAbort);
      if (activeController === controller) {
        activeController = null;
        if (!disposed) setScanning(false);
      }
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
      const e = err instanceof Error ? err : new Error(getUnknownErrorMessage(err));
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
    dispose,
  };
}
