import { describe, it, expect, vi, beforeEach } from 'vitest';
import { effectScope } from 'vue';
import {
  fetchAnnouncementsStream,
  type Announcement as StellarAnnouncement,
  type FetchAnnouncementsOptions,
  type StealthKeys as StellarStealthKeys,
} from '@wraith-protocol/sdk/chains/stellar';
import type {
  Announcement as EvmAnnouncement,
  StealthKeys as EvmStealthKeys,
} from '@wraith-protocol/sdk/chains/evm';
import { useScanner, type ScannerFetchOptions } from '../src/composables/useScanner';

const mockEvmKeys: EvmStealthKeys = vi.hoisted(() => ({
  spendingKey: '0x' + 'ab'.repeat(32),
  viewingKey: '0x' + 'cd'.repeat(32),
  spendingPubKey: '0x' + 'ef'.repeat(33),
  viewingPubKey: '0x' + '01'.repeat(33),
}));

const mockStellarKeys: StellarStealthKeys = vi.hoisted(() => ({
  spendingKey: new Uint8Array(32),
  spendingScalar: 1n,
  viewingKey: new Uint8Array(32),
  viewingScalar: 2n,
  spendingPubKey: new Uint8Array(32),
  viewingPubKey: new Uint8Array(32),
}));

const mockEvmAnnouncements: EvmAnnouncement[] = vi.hoisted(() => [
  {
    schemeId: 1n,
    stealthAddress: '0x' + '02'.repeat(20),
    caller: '0x' + 'aa'.repeat(20),
    ephemeralPubKey: '0x' + '03'.repeat(33),
    metadata: '0x',
  },
]);

const mockStellarAnnouncements: StellarAnnouncement[] = vi.hoisted(() => [
  {
    schemeId: 1,
    stealthAddress: 'GABCDEF1234567890',
    caller: 'GDEADBEEF',
    ephemeralPubKey: 'aa'.repeat(32),
    metadata: '00',
  },
]);

const mockEvmMatched = vi.hoisted(() => [
  {
    isMatch: true,
    stealthAddress: '0x' + '02'.repeat(20),
    viewTag: 42,
  },
]);

const mockStellarMatched = vi.hoisted(() => [
  {
    isMatch: true,
    stealthAddress: 'GABCDEF1234567890',
    hashScalar: 3n,
    stealthPubKeyBytes: new Uint8Array(32),
  },
]);

vi.mock('@wraith-protocol/sdk/chains/evm', () => ({
  fetchAnnouncements: vi.fn().mockResolvedValue(mockEvmAnnouncements),
  scanAnnouncements: vi.fn().mockReturnValue(mockEvmMatched),
  checkStealthAddress: vi.fn().mockReturnValue({
    isMatch: true,
    stealthAddress: '0x' + '02'.repeat(20),
  }),
}));

const mockStellarStreamFactory = vi.hoisted(() => {
  const announcements = [
    {
      schemeId: 1,
      stealthAddress: 'GABCDEF1234567890',
      caller: 'GDEADBEEF',
      ephemeralPubKey: 'aa'.repeat(32),
      metadata: '00',
    },
  ];
  return function createStream() {
    async function* gen() {
      for (const ann of announcements) yield ann;
    }
    return gen();
  };
});

vi.mock('@wraith-protocol/sdk/chains/stellar', () => ({
  fetchAnnouncementsStream: vi.fn().mockImplementation(() => mockStellarStreamFactory()),
  scanAnnouncements: vi.fn().mockReturnValue(mockStellarMatched),
  checkStealthAddress: vi.fn().mockReturnValue({
    isMatch: true,
    stealthAddress: 'GABCDEF1234567890',
    hashScalar: 3n,
    stealthPubKeyBytes: new Uint8Array(32),
  }),
}));

vi.mock('@wraith-protocol/sdk/chains/solana', () => ({
  fetchAnnouncements: vi.fn().mockResolvedValue([]),
  scanAnnouncements: vi.fn().mockReturnValue([]),
  checkStealthAddress: vi.fn().mockReturnValue({ isMatch: true, stealthAddress: null }),
}));

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

describe('useScanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to stellar chain', () => {
    const composable = useScanner();
    expect(composable.chain.value).toBe('stellar');
  });

  it('accepts chain parameter', () => {
    const evm = useScanner('evm');
    expect(evm.chain.value).toBe('evm');
    const stellar = useScanner('stellar');
    expect(stellar.chain.value).toBe('stellar');
  });

  it('setChain changes active chain', () => {
    const composable = useScanner('evm');
    composable.setChain('stellar');
    expect(composable.chain.value).toBe('stellar');
  });

  it('fetches EVM announcements', async () => {
    const composable = useScanner('evm');
    const result = await composable.fetchAnnouncements({ chain: 'evm', network: 'horizen' });
    expect(result).toEqual(mockEvmAnnouncements);
    expect(composable.announcements.value).toEqual(mockEvmAnnouncements);
  });

  it('fetches Stellar announcements', async () => {
    const composable = useScanner('stellar');
    const result = await composable.fetchAnnouncements();
    expect(result).toEqual(mockStellarAnnouncements);
    expect(composable.announcements.value).toEqual(mockStellarAnnouncements);
  });

  it('scans EVM announcements', () => {
    const composable = useScanner('evm');
    const result = composable.scanAnnouncements({
      chain: 'evm',
      announcements: mockEvmAnnouncements,
      keys: mockEvmKeys,
    });
    expect(result).toEqual(mockEvmMatched);
    expect(composable.matched.value).toEqual(mockEvmMatched);
  });

  it('scans Stellar announcements', () => {
    const composable = useScanner('stellar');
    const result = composable.scanAnnouncements({
      chain: 'stellar',
      announcements: mockStellarAnnouncements,
      keys: mockStellarKeys,
    });
    expect(result).toEqual(mockStellarMatched);
    expect(composable.matched.value).toEqual(mockStellarMatched);
  });

  it('checks EVM stealth address', () => {
    const composable = useScanner('evm');
    const result = composable.checkAddress({
      chain: 'evm',
      ephemeralPubKey: '0x' + '03'.repeat(33),
      viewingKey: '0x' + 'cd'.repeat(32),
      spendingPubKey: '0x' + 'ef'.repeat(33),
      viewTag: 42,
    });
    expect(result.isMatch).toBe(true);
  });

  it('checks Stellar stealth address', () => {
    const composable = useScanner('stellar');
    const result = composable.checkAddress({
      chain: 'stellar',
      ephemeralPubKey: new Uint8Array(32),
      viewingKey: new Uint8Array(32),
      spendingPubKey: new Uint8Array(32),
      viewTag: 42,
    });
    expect(result.isMatch).toBe(true);
  });

  it('scanWithKeys fetches and scans EVM', async () => {
    const composable = useScanner('evm');
    const result = await composable.scanWithKeys({ chain: 'evm', keys: mockEvmKeys });
    expect(result).toEqual(mockEvmMatched);
    expect(composable.matched.value).toEqual(mockEvmMatched);
  });

  it('scanWithKeys fetches and scans Stellar', async () => {
    const composable = useScanner('stellar');
    const result = await composable.scanWithKeys({ chain: 'stellar', keys: mockStellarKeys });
    expect(result).toEqual(mockStellarMatched);
    expect(composable.matched.value).toEqual(mockStellarMatched);
  });

  it('clear resets state', () => {
    const composable = useScanner('evm');
    composable.scanAnnouncements({
      chain: 'evm',
      announcements: mockEvmAnnouncements,
      keys: mockEvmKeys,
    });
    expect(composable.matched.value.length).toBe(1);
    composable.clear();
    expect(composable.matched.value.length).toBe(0);
    expect(composable.announcements.value.length).toBe(0);
    expect(composable.error.value).toBeNull();
  });

  it('initial state', () => {
    const composable = useScanner('stellar');
    expect(composable.announcements.value).toEqual([]);
    expect(composable.matched.value).toEqual([]);
    expect(composable.scanning.value).toBe(false);
    expect(composable.error.value).toBeNull();
  });

  it('rejects mismatched key material at runtime for JavaScript consumers', () => {
    const composable = useScanner('evm');

    expect(() =>
      composable.scanAnnouncements({
        chain: 'evm',
        announcements: mockEvmAnnouncements,
        keys: mockStellarKeys as never,
      }),
    ).toThrow(TypeError);

    expect(() =>
      composable.scanAnnouncements({
        chain: 'stellar',
        announcements: mockStellarAnnouncements,
        keys: mockEvmKeys as never,
      }),
    ).toThrow(TypeError);
  });

  it('rejects unknown chains and non-signal cancellation at runtime', async () => {
    const composable = useScanner();

    await expect(
      composable.fetchAnnouncements({ chain: 'bitcoin' } as unknown as ScannerFetchOptions),
    ).rejects.toThrow(TypeError);

    await expect(
      composable.fetchAnnouncements({
        chain: 'stellar',
        signal: 'stop',
      } as unknown as ScannerFetchOptions),
    ).rejects.toThrow(TypeError);
  });

  it('aborts in-flight work when the effect scope is disposed', async () => {
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
      yield mockStellarAnnouncements[0];
    });

    const scope = effectScope();
    const composable = scope.run(() => useScanner('stellar'))!;

    const pending = composable.fetchAnnouncements().catch((err) => err);
    await Promise.resolve();
    await Promise.resolve();

    expect(composable.scanning.value).toBe(true);
    expect(seen).toHaveLength(1);

    scope.stop();
    expect(seen[0].aborted).toBe(true);

    release();
    const outcome = await pending;
    expect((outcome as DOMException).name).toBe('AbortError');
    expect(composable.announcements.value).toEqual([]);
  });

  it('aborts in-flight work when the caller aborts the signal', async () => {
    const seen: AbortSignal[] = [];
    vi.mocked(fetchAnnouncementsStream).mockImplementation(async function* (
      _chain: string,
      options: FetchAnnouncementsOptions = {},
    ) {
      if (options.signal) seen.push(options.signal);
      await rejectOnAbort(options.signal);
      yield mockStellarAnnouncements[0];
    });

    const composable = useScanner('stellar');
    const controller = new AbortController();
    const pending = composable
      .fetchAnnouncements({ chain: 'stellar', signal: controller.signal })
      .catch((err) => err);
    await Promise.resolve();
    await Promise.resolve();

    controller.abort();
    const outcome = await pending;

    expect(seen).toHaveLength(1);
    expect(seen[0].aborted).toBe(true);
    expect((outcome as DOMException).name).toBe('AbortError');
    expect(composable.announcements.value).toEqual([]);
    expect(composable.scanning.value).toBe(false);
    expect(composable.error.value).toBeNull();
  });

  it('discards a superseded fetch even when the source ignores the abort', async () => {
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
      yield index === 0
        ? mockStellarAnnouncements[0]
        : { ...mockStellarAnnouncements[0], ledger: 2 };
    });

    const composable = useScanner('stellar');

    const first = composable.fetchAnnouncements().catch((err) => err);
    await Promise.resolve();
    await Promise.resolve();
    expect(seen[0].aborted).toBe(false);

    const second = composable.fetchAnnouncements();
    expect(seen[0].aborted).toBe(true);

    releases[1]();
    await second;
    expect(composable.announcements.value).toEqual([{ ...mockStellarAnnouncements[0], ledger: 2 }]);

    releases[0]();
    const outcome = await first;
    expect((outcome as DOMException).name).toBe('AbortError');
    expect(composable.announcements.value).toEqual([{ ...mockStellarAnnouncements[0], ledger: 2 }]);
  });
});
