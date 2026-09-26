import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMetaAddress } from '../src/primitives/createMetaAddress';

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

describe('createMetaAddress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports the function', () => {
    expect(typeof createMetaAddress).toBe('function');
  });

  it('initialises with null state and evm chain', () => {
    const primitive = createMetaAddress();
    expect(primitive.encoded()).toBeNull();
    expect(primitive.decoded()).toBeNull();
    expect(primitive.chain()).toBe('evm');
    expect(primitive.error()).toBeNull();
  });

  it('encodes an EVM meta address', () => {
    const primitive = createMetaAddress();
    const result = primitive.encode('0x' + '01'.repeat(33), '0x' + '02'.repeat(33), 'evm');

    expect(result).toBe(evmEncoded);
    expect(primitive.encoded()).toBe(evmEncoded);
    expect(primitive.chain()).toBe('evm');
  });

  it('encodes a Stellar meta address', () => {
    const primitive = createMetaAddress();
    const result = primitive.encode(new Uint8Array(32), new Uint8Array(32), 'stellar');

    expect(result).toBe(stellarEncoded);
    expect(primitive.chain()).toBe('stellar');
  });

  it('encodes a Solana meta address', () => {
    const primitive = createMetaAddress();
    const result = primitive.encode(new Uint8Array(32), new Uint8Array(32), 'solana');

    expect(result).toBe(solanaEncoded);
    expect(primitive.chain()).toBe('solana');
  });

  it('decodes an EVM meta address', () => {
    const primitive = createMetaAddress();
    const result = primitive.decode(evmEncoded);

    expect(result.prefix).toBe('st:eth:0x');
    expect(primitive.chain()).toBe('evm');
  });

  it('decodes a Stellar meta address', () => {
    const primitive = createMetaAddress();
    const result = primitive.decode(stellarEncoded);

    expect(result.prefix).toBe('st:xlm:');
    expect(primitive.chain()).toBe('stellar');
  });

  it('detects the correct chain from prefix', () => {
    const primitive = createMetaAddress();
    expect(primitive.detectChain(evmEncoded)).toBe('evm');
    expect(primitive.detectChain(stellarEncoded)).toBe('stellar');
    expect(primitive.detectChain(solanaEncoded)).toBe('solana');
  });

  it('gets the correct prefix for each chain', () => {
    const primitive = createMetaAddress();
    expect(primitive.getPrefix('evm')).toBe('st:eth:0x');
    expect(primitive.getPrefix('stellar')).toBe('st:xlm:');
    expect(primitive.getPrefix('solana')).toBe('st:sol:');
  });

  it('throws for unknown prefix', () => {
    const primitive = createMetaAddress();
    expect(() => primitive.detectChain('unknown:prefix:abc')).toThrow(
      'Unknown meta address prefix',
    );
  });

  it('selectChain updates the chain signal', () => {
    const primitive = createMetaAddress();
    primitive.selectChain('stellar');
    expect(primitive.chain()).toBe('stellar');
  });

  it('exposes CHAIN_PREFIXES constant', () => {
    const primitive = createMetaAddress();
    expect(primitive.CHAIN_PREFIXES.evm).toBe('st:eth:0x');
    expect(primitive.CHAIN_PREFIXES.stellar).toBe('st:xlm:');
    expect(primitive.CHAIN_PREFIXES.solana).toBe('st:sol:');
  });
});
