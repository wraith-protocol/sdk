import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useScanner } from '../src/composables/useScanner';

const mockEvmKeys = vi.hoisted(() => ({
  spendingKey: '0x' + 'ab'.repeat(32),
  viewingKey: '0x' + 'cd'.repeat(32),
  spendingPubKey: '0x' + 'ef'.repeat(33),
  viewingPubKey: '0x' + '01'.repeat(33),
}));

const mockStellarKeys = vi.hoisted(() => ({
  spendingKey: new Uint8Array(32),
  spendingScalar: 1n,
  viewingKey: new Uint8Array(32),
  viewingScalar: 2n,
  spendingPubKey: new Uint8Array(32),
  viewingPubKey: new Uint8Array(32),
}));

const mockEvmAnnouncements = vi.hoisted(() => [
  {
    schemeId: 1n,
    stealthAddress: '0x' + '02'.repeat(20),
    caller: '0x' + 'aa'.repeat(20),
    ephemeralPubKey: '0x' + '03'.repeat(33),
    metadata: '0x',
  },
]);

const mockStellarAnnouncements = vi.hoisted(() => [
  {
    schemeId: 1,
    stealthAddress: 'GABCDEF1234567890',
    caller: 'GDEADBEEF',
    ephemeralPubKey: new Uint8Array(32),
    metadata: new Uint8Array(0),
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
      ephemeralPubKey: new Uint8Array(32),
      metadata: new Uint8Array(0),
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
  fetchAnnouncements: vi.fn().mockResolvedValue([
    {
      schemeId: 1,
      stealthAddress: 'FAKESOLANA...',
      caller: 'FAKECALLER...',
      ephemeralPubKey: 'ab'.repeat(32),
      metadata: '',
    },
  ]),
  scanAnnouncements: vi.fn().mockReturnValue([
    {
      isMatch: true,
      stealthAddress: 'FAKESOLANA...',
      hashScalar: 3n,
      stealthPubKeyBytes: new Uint8Array(32),
    },
  ]),
  checkStealthAddress: vi.fn().mockReturnValue({
    isMatch: true,
    stealthAddress: 'FAKESOLANA...',
  }),
}));

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
    const result = await composable.fetchAnnouncements('horizen');
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
    const result = composable.scanAnnouncements(
      mockEvmAnnouncements,
      '0x' + 'cd'.repeat(32),
      '0x' + 'ef'.repeat(33),
      '0x' + 'ab'.repeat(32),
    );
    expect(result).toEqual(mockEvmMatched);
    expect(composable.matched.value).toEqual(mockEvmMatched);
  });

  it('scans Stellar announcements', () => {
    const composable = useScanner('stellar');
    const result = composable.scanAnnouncements(
      mockStellarAnnouncements,
      new Uint8Array(32),
      new Uint8Array(32),
      1n,
    );
    expect(result).toEqual(mockStellarMatched);
    expect(composable.matched.value).toEqual(mockStellarMatched);
  });

  it('checks EVM stealth address', () => {
    const composable = useScanner('evm');
    const result = composable.checkAddress(
      '0x' + '03'.repeat(33),
      '0x' + 'cd'.repeat(32),
      '0x' + 'ef'.repeat(33),
      42,
    );
    expect(result.isMatch).toBe(true);
  });

  it('checks Stellar stealth address', () => {
    const composable = useScanner('stellar');
    const result = composable.checkAddress(
      new Uint8Array(32),
      new Uint8Array(32),
      new Uint8Array(32),
      42,
    );
    expect(result.isMatch).toBe(true);
  });

  it('scanWithKeys fetches and scans EVM', async () => {
    const composable = useScanner('evm');
    const result = await composable.scanWithKeys(mockEvmKeys as any);
    expect(result).toEqual(mockEvmMatched);
    expect(composable.matched.value).toEqual(mockEvmMatched);
  });

  it('scanWithKeys fetches and scans Stellar', async () => {
    const composable = useScanner('stellar');
    const result = await composable.scanWithKeys(mockStellarKeys as any);
    expect(result).toEqual(mockStellarMatched);
    expect(composable.matched.value).toEqual(mockStellarMatched);
  });

  it('clear resets state', () => {
    const composable = useScanner('evm');
    composable.scanAnnouncements(
      mockEvmAnnouncements,
      '0x' + 'cd'.repeat(32),
      '0x' + 'ef'.repeat(33),
      '0x' + 'ab'.repeat(32),
    );
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
});
