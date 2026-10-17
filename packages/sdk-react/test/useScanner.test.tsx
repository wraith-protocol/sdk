// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Announcement, FetchAnnouncementsOptions } from '@wraith-protocol/sdk/chains/stellar';

const fetchAnnouncementsStream = vi.hoisted(() => vi.fn());

vi.mock('@wraith-protocol/sdk/chains/stellar', async () => {
  const actual = await vi.importActual<typeof import('@wraith-protocol/sdk/chains/stellar')>(
    '@wraith-protocol/sdk/chains/stellar',
  );
  return { ...actual, fetchAnnouncementsStream };
});

import { useScanner } from '../src/hooks/useScanner';

function announcement(stealthAddress: string): Announcement {
  return {
    schemeId: 1,
    stealthAddress,
    caller: 'GCALLER',
    ephemeralPubKey: 'aa'.repeat(32),
    metadata: '01',
  };
}

function abortError(): DOMException {
  return new DOMException('This operation was aborted', 'AbortError');
}

/** Rejects as soon as the signal aborts, mirroring the SDK's fetch stream. */
function rejectOnAbort(signal?: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    signal?.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

describe('useScanner cancellation', () => {
  beforeEach(() => {
    fetchAnnouncementsStream.mockReset();
  });

  it('publishes a completed scan', async () => {
    fetchAnnouncementsStream.mockImplementation(async function* () {
      yield announcement('GOK');
    });
    const { result, unmount } = renderHook(() => useScanner());

    await act(async () => {
      await result.current.scan();
    });

    expect(result.current.announcements).toEqual([announcement('GOK')]);
    expect(result.current.scanning).toBe(false);
    expect(result.current.error).toBeNull();
    unmount();
  });

  it('aborts an in-flight scan on unmount and never publishes its result', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: AbortSignal[] = [];

    fetchAnnouncementsStream.mockImplementation(async function* (
      _chain: string,
      options: FetchAnnouncementsOptions = {},
    ) {
      if (options.signal) seen.push(options.signal);
      await Promise.race([gate, rejectOnAbort(options.signal)]);
      yield announcement('GSTALE');
    });

    const { result, unmount } = renderHook(() => useScanner());

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.scan().catch((err) => err);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.scanning).toBe(true);
    expect(seen).toHaveLength(1);

    unmount();
    expect(seen[0].aborted).toBe(true);

    release();
    const outcome = await pending;
    expect(outcome).toBeInstanceOf(DOMException);
    expect((outcome as DOMException).name).toBe('AbortError');
    expect(result.current.announcements).toEqual([]);
  });

  it('discards a superseded scan even when the source ignores the abort', async () => {
    const releases: Array<() => void> = [];
    const seen: AbortSignal[] = [];

    fetchAnnouncementsStream.mockImplementation(async function* (
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
      // Deliberately ignores the signal: the hook's stale guard must still win.
      await gate;
      yield announcement(`G${index}`);
    });

    const { result, rerender, unmount } = renderHook(
      ({ wallet }: { wallet: string }) => useScanner({ wallet }),
      { initialProps: { wallet: 'A' } },
    );

    let first!: Promise<unknown>;
    act(() => {
      first = result.current.scan().catch((err) => err);
    });
    await act(async () => {
      await Promise.resolve();
    });

    rerender({ wallet: 'B' });
    expect(seen[0].aborted).toBe(true);

    let second!: Promise<unknown>;
    act(() => {
      second = result.current.scan();
    });
    await act(async () => {
      await Promise.resolve();
    });

    releases[1]();
    await act(async () => {
      await second;
    });
    expect(result.current.announcements).toEqual([announcement('G1')]);

    releases[0]();
    const outcome = await first;
    expect((outcome as DOMException).name).toBe('AbortError');
    expect(result.current.announcements).toEqual([announcement('G1')]);
    unmount();
  });

  it('aborts when the caller aborts the signal passed to scan()', async () => {
    const seen: AbortSignal[] = [];
    fetchAnnouncementsStream.mockImplementation(async function* (
      _chain: string,
      options: FetchAnnouncementsOptions = {},
    ) {
      if (options.signal) seen.push(options.signal);
      await rejectOnAbort(options.signal);
      yield announcement('GSTALE');
    });

    const { result } = renderHook(() => useScanner());
    const controller = new AbortController();

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.scan({ signal: controller.signal }).catch((err) => err);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const outcome = await act(async () => {
      controller.abort();
      return pending;
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].aborted).toBe(true);
    expect((outcome as DOMException).name).toBe('AbortError');
    expect(result.current.announcements).toEqual([]);
    expect(result.current.scanning).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('aborts an in-flight scan when the hook-level signal aborts', async () => {
    const seen: AbortSignal[] = [];
    fetchAnnouncementsStream.mockImplementation(async function* (
      _chain: string,
      options: FetchAnnouncementsOptions = {},
    ) {
      if (options.signal) seen.push(options.signal);
      await rejectOnAbort(options.signal);
      yield announcement('GSTALE');
    });

    const controller = new AbortController();
    const { result } = renderHook(() => useScanner({ signal: controller.signal }));

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.scan().catch((err) => err);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const outcome = await act(async () => {
      controller.abort();
      return pending;
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].aborted).toBe(true);
    expect((outcome as DOMException).name).toBe('AbortError');
    expect(result.current.announcements).toEqual([]);
  });
});
