import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMetaAddress } from '../src/composables/useMetaAddress';

const evmEncoded = vi.hoisted(() => 'st:eth:0x' + 'ab'.repeat(66));
const stellarEncoded = vi.hoisted(() => 'st:xlm:' + 'cd'.repeat(64));
const solanaEncoded = vi.hoisted(() => 'st:sol:' + 'ef'.repeat(64));

vi.mock('@wraith-protocol/sdk/chains/evm', () => ({
  encodeStealthMetaAddress: vi.fn().mockReturnValue(evmEncoded),
  decodeStealthMetaAddress: vi.fn().mockReturnValue({
    prefix: 'st:eth:0x',
    spendingPubKey: '0x' + '01'.repeat(33),
    viewingPubKey: '0x' + '02'.repeat(33),
  }),
  META_ADDRESS_PREFIX: 'st:eth:0x',
}));

vi.mock('@wraith-protocol/sdk/chains/stellar', () => ({
  encodeStealthMetaAddress: vi.fn().mockReturnValue(stellarEncoded),
  decodeStealthMetaAddress: vi.fn().mockReturnValue({
    prefix: 'st:xlm:',
    spendingPubKey: new Uint8Array(32),
    viewingPubKey: new Uint8Array(32),
  }),
  META_ADDRESS_PREFIX: 'st:xlm:',
}));

vi.mock('@wraith-protocol/sdk/chains/solana', () => ({
  encodeStealthMetaAddress: vi.fn().mockReturnValue(solanaEncoded),
  decodeStealthMetaAddress: vi.fn().mockReturnValue({
    prefix: 'st:sol:',
    spendingPubKey: new Uint8Array(32),
    viewingPubKey: new Uint8Array(32),
  }),
  META_ADDRESS_PREFIX: 'st:sol:',
}));

describe('useMetaAddress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('encodes EVM meta address', () => {
    const composable = useMetaAddress();
    const result = composable.encode('0x' + '01'.repeat(33), '0x' + '02'.repeat(33), 'evm');
    expect(result).toBe(evmEncoded);
    expect(composable.encoded.value).toBe(evmEncoded);
    expect(composable.chain.value).toBe('evm');
  });

  it('encodes Stellar meta address', () => {
    const composable = useMetaAddress();
    const result = composable.encode(new Uint8Array(32), new Uint8Array(32), 'stellar');
    expect(result).toBe(stellarEncoded);
    expect(composable.chain.value).toBe('stellar');
  });

  it('encodes Solana meta address', () => {
    const composable = useMetaAddress();
    const result = composable.encode(new Uint8Array(32), new Uint8Array(32), 'solana');
    expect(result).toBe(solanaEncoded);
    expect(composable.chain.value).toBe('solana');
  });

  it('decodes EVM meta address', () => {
    const composable = useMetaAddress();
    const result = composable.decode(evmEncoded);
    expect(result.prefix).toBe('st:eth:0x');
    expect(composable.chain.value).toBe('evm');
  });

  it('detects correct chain from prefix', () => {
    const composable = useMetaAddress();
    expect(composable.detectChain(evmEncoded)).toBe('evm');
    expect(composable.detectChain(stellarEncoded)).toBe('stellar');
    expect(composable.detectChain(solanaEncoded)).toBe('solana');
  });

  it('gets correct prefix for each chain', () => {
    const composable = useMetaAddress();
    expect(composable.getPrefix('evm')).toBe('st:eth:0x');
    expect(composable.getPrefix('stellar')).toBe('st:xlm:');
    expect(composable.getPrefix('solana')).toBe('st:sol:');
  });

  it('throws for unknown prefix', () => {
    const composable = useMetaAddress();
    expect(() => composable.detectChain('unknown:prefix:abc')).toThrow(
      'Unknown meta address prefix',
    );
  });

  it('setChain changes chain', () => {
    const composable = useMetaAddress();
    composable.setChain('stellar');
    expect(composable.chain.value).toBe('stellar');
  });

  it('decode updates encoded ref on decode', () => {
    const composable = useMetaAddress();
    composable.decode(evmEncoded);
    expect(composable.decoded.value).toBeTruthy();
    expect(composable.chain.value).toBe('evm');
  });
});
