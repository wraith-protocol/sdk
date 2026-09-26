import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@wraith-protocol/sdk/chains/evm', () => ({
  encodeStealthMetaAddress: vi.fn().mockReturnValue('st:eth:0x' + 'ab'.repeat(66)),
  decodeStealthMetaAddress: vi.fn().mockReturnValue({
    prefix: 'st:eth:0x',
    spendingPubKey: '0x' + '01'.repeat(33),
    viewingPubKey: '0x' + '02'.repeat(33),
  }),
  META_ADDRESS_PREFIX: 'st:eth:0x',
}));

vi.mock('@wraith-protocol/sdk/chains/stellar', () => ({
  encodeStealthMetaAddress: vi.fn().mockReturnValue('st:xlm:' + 'cd'.repeat(64)),
  decodeStealthMetaAddress: vi.fn().mockReturnValue({
    prefix: 'st:xlm:',
    spendingPubKey: new Uint8Array(32),
    viewingPubKey: new Uint8Array(32),
  }),
  META_ADDRESS_PREFIX: 'st:xlm:',
}));

vi.mock('@wraith-protocol/sdk/chains/solana', () => ({
  encodeStealthMetaAddress: vi.fn().mockReturnValue('st:sol:' + 'ef'.repeat(64)),
  decodeStealthMetaAddress: vi.fn().mockReturnValue({
    prefix: 'st:sol:',
    spendingPubKey: new Uint8Array(32),
    viewingPubKey: new Uint8Array(32),
  }),
  META_ADDRESS_PREFIX: 'st:sol:',
}));

describe('useStealthMetaAddress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports the function', async () => {
    const mod = await import('../src/primitives/useStealthMetaAddress.js');
    expect(typeof mod.useStealthMetaAddress).toBe('function');
  });
});
