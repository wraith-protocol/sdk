import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'solid-js';
import {
  fetchAnnouncementsStream,
  type Announcement,
  type FetchAnnouncementsOptions,
} from '@wraith-protocol/sdk/chains/stellar';
import { createScanner } from '../src/primitives/createScanner';

const mockAnnouncements = vi.hoisted(() => [
  {
    ephemeralPubKey: new Uint8Array(32),
    viewTag: 42,
    stealthAddress: 'GABCDEF1234567890',
  },
]);

const mockMatched = vi.hoisted(() => [
  {
    stealthAddress: 'GABCDEF1234567890',
    ephemeralPubKey: new Uint8Array(32),
    viewTag: 42,
    stealthPrivateScalar: 99n,
    stealthPubKeyBytes: new Uint8Array(32),
  },
]);

// Async generator that yields mock announcements
async function* mockStream() {
  for (const a of mockAnnouncements) {
    yield a;
  }
}

vi.mock('@wraith-protocol/sdk/chains/stellar', () => ({
  fetchAnnouncementsStream: vi.fn().mockImplementation(() => mockStream()),
  scanAnnouncements: vi.fn().mockReturnValue(mockMatched),
}));

describe('createScanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports the function', () => {
    expect(typeof createScanner).toBe('function');
  });

  it('initialises with empty reactive state', () => {
    const primitive = createScanner();
    expect(primitive.announcements()).toEqual([]);
    expect(primitive.matched()).toEqual([]);
    expect(primitive.scanning()).toBe(false);
    expect(primitive.error()).toBeNull();
  });

  it('scan fetches announcements and updates signals', async () => {
    const primitive = createScanner();
    const result = await primitive.scan('testnet');

    expect(result).toEqual(mockAnnouncements);
    expect(primitive.announcements()).toEqual(mockAnnouncements);
    expect(primitive.scanning()).toBe(false);
    expect(primitive.error()).toBeNull();
  });

  it('match filters announcements for matching keys', () => {
    const primitive = createScanner();
    const result = primitive.match(
      mockAnnouncements as any,
      new Uint8Array(32),
      new Uint8Array(32),
      1n,
    );

    expect(result).toEqual(mockMatched);
    expect(primitive.matched()).toEqual(mockMatched);
  });

  it('scanAndMatch performs fetch then match', async () => {
    const primitive = createScanner();
    const result = await primitive.scanAndMatch(
      new Uint8Array(32),
      new Uint8Array(32),
      1n,
      'testnet',
    );

    expect(result).toEqual(mockMatched);
    expect(primitive.announcements()).toEqual(mockAnnouncements);
    expect(primitive.matched()).toEqual(mockMatched);
  });

  it('sets error signal when scan throws', async () => {
    const { fetchAnnouncementsStream: mockFetch } = vi.mocked(
      await import('@wraith-protocol/sdk/chains/stellar'),
    );
    mockFetch.mockImplementationOnce(async function* () {
      throw new Error('network error');
    });

    const primitive = createScanner();
    await expect(primitive.scan('testnet')).rejects.toThrow('network error');
    expect(primitive.error()).toBeInstanceOf(Error);
    expect(primitive.error()!.message).toBe('network error');
    expect(primitive.scanning()).toBe(false);
  });

  describe('cancellation', () => {
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

    it('aborts an in-flight scan when the owning root is disposed', async () => {
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

      let primitive!: ReturnType<typeof createScanner>;
      const disposeRoot = createRoot((dispose) => {
        primitive = createScanner();
        return dispose;
      });

      const pending = primitive.scan('stellar').catch((err) => err);
      await Promise.resolve();
      await Promise.resolve();

      expect(primitive.scanning()).toBe(true);
      expect(seen).toHaveLength(1);

      disposeRoot();
      expect(seen[0].aborted).toBe(true);

      release();
      const outcome = await pending;
      expect((outcome as DOMException).name).toBe('AbortError');
      expect(primitive.announcements()).toEqual([]);
      expect(primitive.error()).toBeNull();
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

      const primitive = createScanner();
      const controller = new AbortController();
      const pending = primitive.scan('stellar', { signal: controller.signal }).catch((err) => err);
      await Promise.resolve();
      await Promise.resolve();

      controller.abort();
      const outcome = await pending;

      expect(seen).toHaveLength(1);
      expect(seen[0].aborted).toBe(true);
      expect((outcome as DOMException).name).toBe('AbortError');
      expect(primitive.announcements()).toEqual([]);
      expect(primitive.scanning()).toBe(false);
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
        await gate;
        yield { ...announcement, ledger: index + 1 };
      });

      const primitive = createScanner();

      const first = primitive.scan('stellar').catch((err) => err);
      await Promise.resolve();
      await Promise.resolve();
      expect(seen[0].aborted).toBe(false);

      const second = primitive.scan('stellar');
      expect(seen[0].aborted).toBe(true);

      releases[1]();
      await second;
      expect(primitive.announcements()).toEqual([{ ...announcement, ledger: 2 }]);

      releases[0]();
      const outcome = await first;
      expect((outcome as DOMException).name).toBe('AbortError');
      expect(primitive.announcements()).toEqual([{ ...announcement, ledger: 2 }]);
    });
  });
});
