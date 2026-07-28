import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useActivity } from '../src/composables/useActivity';

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
  scanAnnouncements: vi.fn().mockReturnValue(mockEvmMatched),
}));

vi.mock('@wraith-protocol/sdk/chains/stellar', () => ({
  scanAnnouncements: vi.fn().mockReturnValue(mockStellarMatched),
}));

vi.mock('@wraith-protocol/sdk/chains/solana', () => ({
  scanAnnouncements: vi.fn().mockReturnValue([
    {
      isMatch: true,
      stealthAddress: 'FAKESOLANA...',
      hashScalar: 3n,
      stealthPubKeyBytes: new Uint8Array(32),
    },
  ]),
}));

describe('useActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initial state is empty', () => {
    const composable = useActivity();
    expect(composable.scanning.value).toBe(false);
    expect(composable.error.value).toBeNull();
    expect(composable.events.value).toEqual([]);
    expect(composable.totalMatched.value).toBe(0);
  });

  it('scans EVM announcements and creates events', async () => {
    const composable = useActivity();
    const result = await composable.scanAnnouncements([
      {
        chain: 'evm',
        announcements: [
          {
            schemeId: 1n,
            stealthAddress: '0x' + '02'.repeat(20),
            caller: '0x' + 'aa'.repeat(20),
            ephemeralPubKey: '0x' + '03'.repeat(33),
            metadata: '0x',
          },
        ],
        keys: mockEvmKeys as any,
      },
    ]);
    expect(result.length).toBe(1);
    expect(result[0].chain).toBe('evm');
    expect(result[0].type).toBe('incoming');
    expect(result[0].stealthAddress).toBe('0x' + '02'.repeat(20));
    expect(composable.events.value.length).toBe(1);
    expect(composable.totalMatched.value).toBe(1);
  });

  it('scans Stellar announcements and creates events', async () => {
    const composable = useActivity();
    const result = await composable.scanAnnouncements([
      {
        chain: 'stellar',
        announcements: [
          {
            schemeId: 1,
            stealthAddress: 'GABCDEF1234567890',
            caller: 'GDEADBEEF',
            ephemeralPubKey: new Uint8Array(32),
            metadata: new Uint8Array(0),
          },
        ],
        keys: mockStellarKeys as any,
      },
    ]);
    expect(result.length).toBe(1);
    expect(result[0].chain).toBe('stellar');
    expect(result[0].stealthAddress).toBe('GABCDEF1234567890');
    expect(composable.events.value.length).toBe(1);
    expect(composable.totalMatched.value).toBe(1);
  });

  it('scans multiple chains', async () => {
    const composable = useActivity();
    await composable.scanAnnouncements([
      {
        chain: 'evm',
        announcements: [],
        keys: mockEvmKeys as any,
      },
      {
        chain: 'stellar',
        announcements: [
          {
            schemeId: 1,
            stealthAddress: 'GABCDEF1234567890',
            caller: 'GDEADBEEF',
            ephemeralPubKey: new Uint8Array(32),
            metadata: new Uint8Array(0),
          },
        ],
        keys: mockStellarKeys as any,
      },
    ]);
    expect(composable.events.value.length).toBe(1);
    expect(composable.totalMatched.value).toBe(1);
  });

  it('accumulates events across multiple scans', async () => {
    const composable = useActivity();
    await composable.scanAnnouncements([
      {
        chain: 'evm',
        announcements: [
          {
            schemeId: 1n,
            stealthAddress: '0x' + '02'.repeat(20),
            caller: '0x' + 'aa'.repeat(20),
            ephemeralPubKey: '0x' + '03'.repeat(33),
            metadata: '0x',
          },
        ],
        keys: mockEvmKeys as any,
      },
    ]);
    await composable.scanAnnouncements([
      {
        chain: 'stellar',
        announcements: [
          {
            schemeId: 1,
            stealthAddress: 'GABCDEF1234567890',
            caller: 'GDEADBEEF',
            ephemeralPubKey: new Uint8Array(32),
            metadata: new Uint8Array(0),
          },
        ],
        keys: mockStellarKeys as any,
      },
    ]);
    expect(composable.events.value.length).toBe(2);
    expect(composable.totalMatched.value).toBe(2);
  });

  it('clear resets state', async () => {
    const composable = useActivity();
    await composable.scanAnnouncements([
      {
        chain: 'evm',
        announcements: [
          {
            schemeId: 1n,
            stealthAddress: '0x' + '02'.repeat(20),
            caller: '0x' + 'aa'.repeat(20),
            ephemeralPubKey: '0x' + '03'.repeat(33),
            metadata: '0x',
          },
        ],
        keys: mockEvmKeys as any,
      },
    ]);
    expect(composable.totalMatched.value).toBe(1);
    composable.clear();
    expect(composable.events.value.length).toBe(0);
    expect(composable.totalMatched.value).toBe(0);
    expect(composable.error.value).toBeNull();
  });

  it('handles empty announcements for all chains', async () => {
    const composable = useActivity();
    const result = await composable.scanAnnouncements([
      { chain: 'evm', announcements: [], keys: mockEvmKeys as any },
      { chain: 'stellar', announcements: [], keys: mockStellarKeys as any },
    ]);
    expect(result.length).toBe(0);
    expect(composable.totalMatched.value).toBe(0);
  });
});
