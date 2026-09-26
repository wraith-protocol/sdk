import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@wraith-protocol/sdk/chains/evm', () => ({
  deriveStealthKeys: vi.fn().mockReturnValue({
    spendingKey: '0x' + 'ab'.repeat(32),
    viewingKey: '0x' + 'cd'.repeat(32),
    spendingPubKey: '0x' + 'ef'.repeat(33),
    viewingPubKey: '0x' + '01'.repeat(33),
  }),
  generateStealthAddress: vi.fn().mockReturnValue({
    stealthAddress: '0x' + '02'.repeat(20),
    ephemeralPubKey: '0x' + '03'.repeat(33),
    viewTag: 42,
  }),
  checkStealthAddress: vi.fn().mockReturnValue({
    isMatch: true,
    stealthAddress: '0x' + '02'.repeat(20),
  }),
  scanAnnouncements: vi.fn().mockReturnValue([]),
  deriveStealthPrivateKey: vi.fn().mockReturnValue('0x' + '04'.repeat(32)),
  encodeStealthMetaAddress: vi.fn().mockReturnValue('st:eth:0xabc...'),
  decodeStealthMetaAddress: vi.fn().mockReturnValue({
    prefix: 'st:eth:0x',
    spendingPubKey: '0x' + 'ef'.repeat(33),
    viewingPubKey: '0x' + '01'.repeat(33),
  }),
  fetchAnnouncements: vi.fn().mockResolvedValue([]),
}));

describe('useEvmStealthKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports the function', async () => {
    const mod = await import('../src/primitives/useEvmStealthKeys.js');
    expect(typeof mod.useEvmStealthKeys).toBe('function');
  });
});
