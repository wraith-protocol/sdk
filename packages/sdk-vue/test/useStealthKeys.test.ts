import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStealthKeys } from '../src/composables/useStealthKeys';

const mockEvmKeys = vi.hoisted(() => ({
  spendingKey: '0x' + 'ab'.repeat(32),
  viewingKey: '0x' + 'cd'.repeat(32),
  spendingPubKey: '0x' + 'ef'.repeat(33),
  viewingPubKey: '0x' + '01'.repeat(33),
}));

const mockEvmAddress = vi.hoisted(() => ({
  stealthAddress: '0x' + '02'.repeat(20),
  ephemeralPubKey: '0x' + '03'.repeat(33),
  viewTag: 42,
}));

const mockStellarKeys = vi.hoisted(() => ({
  spendingKey: new Uint8Array(32),
  spendingScalar: 1n,
  viewingKey: new Uint8Array(32),
  viewingScalar: 2n,
  spendingPubKey: new Uint8Array(32),
  viewingPubKey: new Uint8Array(32),
}));

const mockStellarAddress = vi.hoisted(() => ({
  stealthAddress: 'GABCDEF1234567890',
  ephemeralPubKey: new Uint8Array(32),
  viewTag: 42,
}));

vi.mock('@wraith-protocol/sdk/chains/evm', () => ({
  deriveStealthKeys: vi.fn().mockReturnValue(mockEvmKeys),
  generateStealthAddress: vi.fn().mockReturnValue(mockEvmAddress),
  checkStealthAddress: vi.fn().mockReturnValue({
    isMatch: true,
    stealthAddress: '0x' + '02'.repeat(20),
  }),
  deriveStealthPrivateKey: vi.fn().mockReturnValue('0x' + '04'.repeat(32)),
}));

vi.mock('@wraith-protocol/sdk/chains/stellar', () => ({
  deriveStealthKeys: vi.fn().mockReturnValue(mockStellarKeys),
  generateStealthAddress: vi.fn().mockReturnValue(mockStellarAddress),
  checkStealthAddress: vi.fn().mockReturnValue({
    isMatch: true,
    stealthAddress: 'GABCDEF1234567890',
    hashScalar: 3n,
    stealthPubKeyBytes: new Uint8Array(32),
  }),
  deriveStealthPrivateScalar: vi.fn().mockReturnValue(3n),
}));

vi.mock('@wraith-protocol/sdk/chains/solana', () => ({
  deriveStealthKeys: vi.fn().mockReturnValue(mockStellarKeys),
  generateStealthAddress: vi.fn().mockReturnValue({
    stealthAddress: 'FAKESOLANA...',
    ephemeralPubKey: new Uint8Array(32),
    viewTag: 42,
  }),
  checkStealthAddress: vi.fn().mockReturnValue({
    isMatch: true,
    stealthAddress: 'FAKESOLANA...',
    hashScalar: 3n,
    stealthPubKeyBytes: new Uint8Array(32),
  }),
  deriveStealthPrivateScalar: vi.fn().mockReturnValue(3n),
}));

describe('useStealthKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to stellar chain', () => {
    const composable = useStealthKeys();
    expect(composable.chain.value).toBe('stellar');
  });

  it('accepts chain parameter', () => {
    const evm = useStealthKeys('evm');
    expect(evm.chain.value).toBe('evm');
    const stellar = useStealthKeys('stellar');
    expect(stellar.chain.value).toBe('stellar');
    const solana = useStealthKeys('solana');
    expect(solana.chain.value).toBe('solana');
  });

  it('derives EVM keys from signature', () => {
    const composable = useStealthKeys('evm');
    const result = composable.deriveKeys('0x' + 'ff'.repeat(65));
    expect(result).toEqual(mockEvmKeys);
    expect(composable.keys.value).toEqual(mockEvmKeys);
  });

  it('derives Stellar keys from signature', () => {
    const composable = useStealthKeys('stellar');
    const sig = new Uint8Array(64);
    const result = composable.deriveKeys(sig);
    expect(result).toEqual(mockStellarKeys);
    expect(composable.keys.value).toEqual(mockStellarKeys);
  });

  it('derives Solana keys from signature', () => {
    const composable = useStealthKeys('solana');
    const sig = new Uint8Array(64);
    const result = composable.deriveKeys(sig);
    expect(result).toEqual(mockStellarKeys);
    expect(composable.keys.value).toEqual(mockStellarKeys);
  });

  it('generates EVM stealth address', () => {
    const composable = useStealthKeys('evm');
    const result = composable.generateAddress('0x' + 'ef'.repeat(33), '0x' + '01'.repeat(33));
    expect(result).toEqual(mockEvmAddress);
    expect(composable.stealthAddress.value).toEqual(mockEvmAddress);
  });

  it('generates Stellar stealth address', () => {
    const composable = useStealthKeys('stellar');
    const result = composable.generateAddress(new Uint8Array(32), new Uint8Array(32));
    expect(result).toEqual(mockStellarAddress);
    expect(composable.stealthAddress.value).toEqual(mockStellarAddress);
  });

  it('checks EVM stealth address', () => {
    const composable = useStealthKeys('evm');
    const result = composable.checkAddress(
      '0x' + '03'.repeat(33),
      '0x' + 'cd'.repeat(32),
      '0x' + 'ef'.repeat(33),
      42,
    );
    expect(result.isMatch).toBe(true);
  });

  it('checks Stellar stealth address', () => {
    const composable = useStealthKeys('stellar');
    const result = composable.checkAddress(
      new Uint8Array(32),
      new Uint8Array(32),
      new Uint8Array(32),
      42,
    );
    expect(result.isMatch).toBe(true);
  });

  it('derives EVM private key', () => {
    const composable = useStealthKeys('evm');
    const result = composable.derivePrivateKey(
      '0x' + 'ab'.repeat(32),
      '0x' + '03'.repeat(33),
      '0x' + 'cd'.repeat(32),
    );
    expect(result).toBe('0x' + '04'.repeat(32));
  });

  it('derives Stellar private scalar', () => {
    const composable = useStealthKeys('stellar');
    const result = composable.derivePrivateKey(1n, new Uint8Array(32), new Uint8Array(32));
    expect(result).toBe(3n);
  });

  it('setChain changes active chain', () => {
    const composable = useStealthKeys('stellar');
    expect(composable.chain.value).toBe('stellar');
    composable.setChain('evm');
    expect(composable.chain.value).toBe('evm');
  });

  it('manages loading state', () => {
    const composable = useStealthKeys('stellar');
    composable.deriveKeys(new Uint8Array(64));
    expect(composable.loading.value).toBe(false);
  });

  it('error state is null initially', () => {
    const composable = useStealthKeys('stellar');
    expect(composable.error.value).toBeNull();
  });

  it('keys is null initially', () => {
    const composable = useStealthKeys('stellar');
    expect(composable.keys.value).toBeNull();
  });

  it('stealthAddress is null initially', () => {
    const composable = useStealthKeys('stellar');
    expect(composable.stealthAddress.value).toBeNull();
  });
});
