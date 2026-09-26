import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@wraith-protocol/sdk/chains/solana', () => ({
  deriveStealthKeys: vi.fn().mockReturnValue({
    spendingKey: new Uint8Array(32),
    spendingScalar: 1n,
    viewingKey: new Uint8Array(32),
    viewingScalar: 2n,
    spendingPubKey: new Uint8Array(32),
    viewingPubKey: new Uint8Array(32),
  }),
  generateStealthAddress: vi.fn().mockReturnValue({
    stealthAddress: 'FAK9FSoLAnAAddresS11111111111111111111111111111',
    ephemeralPubKey: new Uint8Array(32),
    viewTag: 42,
  }),
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

  it('exports the function', async () => {
    const mod = await import('../src/primitives/useSolanaStealthKeys.js');
    expect(typeof mod.useSolanaStealthKeys).toBe('function');
  });
});
