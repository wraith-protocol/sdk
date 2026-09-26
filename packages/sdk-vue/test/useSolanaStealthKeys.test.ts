import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSolanaStealthKeys } from '../src/composables/useSolanaStealthKeys';

const mockKeys = vi.hoisted(() => ({
  spendingKey: new Uint8Array(32),
  spendingScalar: 1n,
  viewingKey: new Uint8Array(32),
  viewingScalar: 2n,
  spendingPubKey: new Uint8Array(32),
  viewingPubKey: new Uint8Array(32),
}));

const mockAddress = vi.hoisted(() => ({
  stealthAddress: 'FAK9FSoLAnAAddresS11111111111111111111111111111',
  ephemeralPubKey: new Uint8Array(32),
  viewTag: 42,
}));

vi.mock('@wraith-protocol/sdk/chains/solana', () => ({
  deriveStealthKeys: vi.fn().mockReturnValue(mockKeys),
  generateStealthAddress: vi.fn().mockReturnValue(mockAddress),
  checkStealthAddress: vi.fn().mockReturnValue({
    isMatch: true,
    stealthAddress: 'FAK9FSoLAnAAddresS11111111111111111111111111111',
    hashScalar: 3n,
    stealthPubKeyBytes: new Uint8Array(32),
  }),
  scanAnnouncements: vi.fn().mockReturnValue([]),
  deriveStealthPrivateScalar: vi.fn().mockReturnValue(3n),
  encodeStealthMetaAddress: vi.fn().mockReturnValue('st:sol:abc...'),
  decodeStealthMetaAddress: vi.fn().mockReturnValue({
    prefix: 'st:sol:',
    spendingPubKey: new Uint8Array(32),
    viewingPubKey: new Uint8Array(32),
  }),
  fetchAnnouncements: vi.fn().mockResolvedValue([]),
}));

describe('useSolanaStealthKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives keys from signature', () => {
    const composable = useSolanaStealthKeys();
    const sig = new Uint8Array(64);
    const result = composable.deriveKeys(sig);
    expect(result).toEqual(mockKeys);
    expect(composable.keys.value).toEqual(mockKeys);
  });

  it('generates stealth address', () => {
    const composable = useSolanaStealthKeys();
    const result = composable.generateAddress(new Uint8Array(32), new Uint8Array(32));
    expect(result).toEqual(mockAddress);
    expect(composable.stealthAddress.value).toEqual(mockAddress);
  });

  it('checks stealth address', () => {
    const composable = useSolanaStealthKeys();
    const result = composable.checkAddress(
      new Uint8Array(32),
      new Uint8Array(32),
      new Uint8Array(32),
      42,
    );
    expect(result.isMatch).toBe(true);
  });

  it('derives private scalar', () => {
    const composable = useSolanaStealthKeys();
    const result = composable.derivePrivateScalar(1n, new Uint8Array(32), new Uint8Array(32));
    expect(result).toBe(3n);
  });

  it('encodes meta address', () => {
    const composable = useSolanaStealthKeys();
    const result = composable.encodeMetaAddress(new Uint8Array(32), new Uint8Array(32));
    expect(result).toBe('st:sol:abc...');
  });
});
