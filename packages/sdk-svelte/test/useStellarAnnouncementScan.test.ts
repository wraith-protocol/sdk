import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAnnouncementsStream,
  type Announcement,
  type FetchAnnouncementsOptions,
} from '@wraith-protocol/sdk/chains/stellar';
import { useStellarAnnouncementScan } from '../src/primitives/useStellarAnnouncementScan';

vi.mock('@wraith-protocol/sdk/chains/stellar', () => ({
  fetchAnnouncementsStream: vi.fn(),
}));

const announcement: Announcement = {
  schemeId: 1,
  stealthAddress: 'GSTEALTH',
  caller: 'GCALLER',
  ephemeralPubKey: 'aa'.repeat(32),
  metadata: '00',
};

function abortError(): DOMException {
  return new DOMException('This operation was aborted', 'AbortError');
}

function rejectOnAbort(signal?: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    signal?.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

describe('useStellarAnnouncementScan cancellation', () => {
  beforeEach(() => {
    vi.mocked(fetchAnnouncementsStream).mockReset();
  });

  it('publishes a completed scan', async () => {
    vi.mocked(fetchAnnouncementsStream).mockImplementation(async function* () {
      yield announcement;
    });
    const state = useStellarAnnouncementScan();

    await expect(state.scan({ fromLedger: 10 })).resolves.toEqual([announcement]);
    expect(get(state.announcements)).toEqual([announcement]);
    expect(get(state.scanning)).toBe(false);
    expect(get(state.error)).toBeNull();
  });

  it('aborts an in-flight scan on dispose and never publishes its result', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: AbortSignal[] = [];

    vi.mocked(fetchAnnouncementsStream).mockImplementation(async function* (
      _chain: string,
      options: FetchAnnouncementsOptions = {},
    ) {
      if (options.signal) seen.push(options.signal);
      await Promise.race([gate, rejectOnAbort(options.signal)]);
      yield announcement;
    });

    const state = useStellarAnnouncementScan();
    const pending = state.scan().catch((err) => err);
    await Promise.resolve();
    await Promise.resolve();

    expect(get(state.scanning)).toBe(true);
    expect(seen).toHaveLength(1);

    state.dispose();
    expect(seen[0].aborted).toBe(true);

    release();
    const outcome = await pending;
    expect((outcome as DOMException).name).toBe('AbortError');
    expect(get(state.announcements)).toEqual([]);
    expect(get(state.error)).toBeNull();
  });

  it('aborts when the caller aborts the signal passed to scan()', async () => {
    const seen: AbortSignal[] = [];
    vi.mocked(fetchAnnouncementsStream).mockImplementation(async function* (
      _chain: string,
      options: FetchAnnouncementsOptions = {},
    ) {
      if (options.signal) seen.push(options.signal);
      await rejectOnAbort(options.signal);
      yield announcement;
    });

    const state = useStellarAnnouncementScan();
    const controller = new AbortController();
    const pending = state.scan({ signal: controller.signal }).catch((err) => err);
    await Promise.resolve();
    await Promise.resolve();

    controller.abort();
    const outcome = await pending;

    expect(seen).toHaveLength(1);
    expect(seen[0].aborted).toBe(true);
    expect((outcome as DOMException).name).toBe('AbortError');
    expect(get(state.announcements)).toEqual([]);
    expect(get(state.scanning)).toBe(false);
  });

  it('cancels scans created after the factory signal aborts', async () => {
    const controller = new AbortController();
    const state = useStellarAnnouncementScan({ signal: controller.signal });
    controller.abort();

    await expect(state.scan()).rejects.toThrow(DOMException);
    expect(get(state.announcements)).toEqual([]);
  });

  it('discards a superseded scan even when the source ignores the abort', async () => {
    const releases: Array<() => void> = [];
    const seen: AbortSignal[] = [];

    vi.mocked(fetchAnnouncementsStream).mockImplementation(async function* (
      _chain: string,
      options: FetchAnnouncementsOptions = {},
    ) {
      const index = releases.length;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      releases.push(release);
      if (options.signal) seen.push(options.signal);
      // Deliberately ignores the signal: the primitive's stale guard must win.
      await gate;
      yield { ...announcement, ledger: index + 1 };
    });

    const state = useStellarAnnouncementScan();

    const first = state.scan().catch((err) => err);
    await Promise.resolve();
    await Promise.resolve();
    expect(seen[0].aborted).toBe(false);

    const second = state.scan();
    expect(seen[0].aborted).toBe(true);

    releases[1]();
    await second;
    expect(get(state.announcements)).toEqual([{ ...announcement, ledger: 2 }]);

    releases[0]();
    const outcome = await first;
    expect((outcome as DOMException).name).toBe('AbortError');
    expect(get(state.announcements)).toEqual([{ ...announcement, ledger: 2 }]);
  });
});
