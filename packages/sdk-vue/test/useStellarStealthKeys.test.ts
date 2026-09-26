import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStellarStealthKeys } from '../src/composables/useStellarStealthKeys';

const mockKeys = vi.hoisted(() => ({
  spendingKey: new Uint8Array(32),
  spendingScalar: 1n,
  viewingKey: new Uint8Array(32),
  viewingScalar: 2n,
  spendingPubKey: new Uint8Array(32),
  viewingPubKey: new Uint8Array(32),
}));

const mockAddress = vi.hoisted(() => ({
  stealthAddress: 'GABCDEF1234567890',
  ephemeralPubKey: new Uint8Array(32),
  viewTag: 42,
}));

const mockStreamFactory = vi.hoisted(() => {
  return function createEmptyStream() {
    async function* gen() {
      yield* [];
    }
    return gen();
  };
});

vi.mock('@wraith-protocol/sdk/chains/stellar', () => ({
  deriveStealthKeys: vi.fn().mockReturnValue(mockKeys),
  generateStealthAddress: vi.fn().mockReturnValue(mockAddress),
  checkStealthAddress: vi.fn().mockReturnValue({
    isMatch: true,
    stealthAddress: 'GABCDEF1234567890',
    hashScalar: 3n,
    stealthPubKeyBytes: new Uint8Array(32),
  }),
  scanAnnouncements: vi.fn().mockReturnValue([]),
  deriveStealthPrivateScalar: vi.fn().mockReturnValue(3n),
  encodeStealthMetaAddress: vi.fn().mockReturnValue('st:xlm:abc...'),
  decodeStealthMetaAddress: vi.fn().mockReturnValue({
    prefix: 'st:xlm:',
    spendingPubKey: new Uint8Array(32),
    viewingPubKey: new Uint8Array(32),
  }),
  fetchAnnouncementsStream: vi.fn().mockImplementation(() => mockStreamFactory()),
}));

describe('useStellarStealthKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives keys from signature', () => {
    const composable = useStellarStealthKeys();
    const sig = new Uint8Array(64);
    const result = composable.deriveKeys(sig);
    expect(result).toEqual(mockKeys);
    expect(composable.keys.value).toEqual(mockKeys);
  });

  it('generates stealth address', () => {
    const composable = useStellarStealthKeys();
    const result = composable.generateAddress(new Uint8Array(32), new Uint8Array(32));
    expect(result).toEqual(mockAddress);
    expect(composable.stealthAddress.value).toEqual(mockAddress);
  });

  it('checks stealth address', () => {
    const composable = useStellarStealthKeys();
    const result = composable.checkAddress(
      new Uint8Array(32),
      new Uint8Array(32),
      new Uint8Array(32),
      42,
    );
    expect(result.isMatch).toBe(true);
  });

  it('encodes meta address', () => {
    const composable = useStellarStealthKeys();
    const result = composable.encodeMetaAddress(new Uint8Array(32), new Uint8Array(32));
    expect(result).toBe('st:xlm:abc...');
  });

  it('decodes meta address', () => {
    const composable = useStellarStealthKeys();
    const result = composable.decodeMetaAddress('st:xlm:abc...');
    expect(result.prefix).toBe('st:xlm:');
  });

  it('manages loading state during sync operations', () => {
    const composable = useStellarStealthKeys();
    composable.deriveKeys(new Uint8Array(64));
    expect(composable.loading.value).toBe(false);
  });
});
