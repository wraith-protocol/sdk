import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEvmStealthKeys } from '../src/composables/useEvmStealthKeys';

const mockKeys = vi.hoisted(() => ({
  spendingKey: '0x' + 'ab'.repeat(32),
  viewingKey: '0x' + 'cd'.repeat(32),
  spendingPubKey: '0x' + 'ef'.repeat(33),
  viewingPubKey: '0x' + '01'.repeat(33),
}));

const mockAddress = vi.hoisted(() => ({
  stealthAddress: '0x' + '02'.repeat(20),
  ephemeralPubKey: '0x' + '03'.repeat(33),
  viewTag: 42,
}));

vi.mock('@wraith-protocol/sdk/chains/evm', () => ({
  deriveStealthKeys: vi.fn().mockReturnValue(mockKeys),
  generateStealthAddress: vi.fn().mockReturnValue(mockAddress),
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

  it('derives keys from signature', () => {
    const composable = useEvmStealthKeys();
    const result = composable.deriveKeys('0x' + 'ff'.repeat(65));
    expect(result).toEqual(mockKeys);
    expect(composable.keys.value).toEqual(mockKeys);
  });

  it('generates stealth address', () => {
    const composable = useEvmStealthKeys();
    const result = composable.generateAddress('0x' + 'ef'.repeat(33), '0x' + '01'.repeat(33));
    expect(result).toEqual(mockAddress);
    expect(composable.stealthAddress.value).toEqual(mockAddress);
  });

  it('checks stealth address', () => {
    const composable = useEvmStealthKeys();
    const result = composable.checkAddress(
      '0x' + '03'.repeat(33),
      '0x' + 'cd'.repeat(32),
      '0x' + 'ef'.repeat(33),
      42,
    );
    expect(result.isMatch).toBe(true);
  });

  it('derives private key', () => {
    const composable = useEvmStealthKeys();
    const result = composable.derivePrivateKey(
      '0x' + 'ab'.repeat(32),
      '0x' + '03'.repeat(33),
      '0x' + 'cd'.repeat(32),
    );
    expect(result).toBe('0x' + '04'.repeat(32));
  });

  it('encodes meta address', () => {
    const composable = useEvmStealthKeys();
    const result = composable.encodeMetaAddress('0x' + 'ef'.repeat(33), '0x' + '01'.repeat(33));
    expect(result).toBe('st:eth:0xabc...');
  });
});
