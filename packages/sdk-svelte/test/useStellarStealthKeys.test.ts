import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@wraith-protocol/sdk/chains/stellar', () => ({
  deriveStealthKeys: vi.fn().mockReturnValue({
    spendingKey: new Uint8Array(32),
    spendingScalar: 1n,
    viewingKey: new Uint8Array(32),
    viewingScalar: 2n,
    spendingPubKey: new Uint8Array(32),
    viewingPubKey: new Uint8Array(32),
  }),
  generateStealthAddress: vi.fn().mockReturnValue({
    stealthAddress: 'GABCDEF1234567890',
    ephemeralPubKey: new Uint8Array(32),
    viewTag: 42,
  }),
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
  fetchAnnouncements: vi.fn().mockResolvedValue([]),
}));

describe('useStellarStealthKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports the function', async () => {
    const mod = await import('../src/primitives/useStellarStealthKeys.js');
    expect(typeof mod.useStellarStealthKeys).toBe('function');
  });
});
