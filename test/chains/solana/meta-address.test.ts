import { describe, test, expect } from 'vitest';
import { deriveStealthKeys } from '../../../src/chains/solana/keys';
import {
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
} from '../../../src/chains/solana/meta-address';

const testSig = new Uint8Array(64).fill(0xaa);

describe('meta-address', () => {
  test('encode produces correct format', () => {
    const keys = deriveStealthKeys(testSig);
    const meta = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);

    expect(meta).toMatch(/^st:sol:[0-9a-f]{128}$/);
  });

  test('encode/decode roundtrip', () => {
    const keys = deriveStealthKeys(testSig);
    const meta = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
    const decoded = decodeStealthMetaAddress(meta);

    expect(decoded.spendingPubKey).toEqual(keys.spendingPubKey);
    expect(decoded.viewingPubKey).toEqual(keys.viewingPubKey);
    expect(decoded.prefix).toBe('st:sol:');
  });

  test('rejects invalid prefix', () => {
    expect(() => decodeStealthMetaAddress('st:eth:0x' + 'aa'.repeat(64))).toThrow(
      'Invalid stealth meta-address prefix',
    );
  });

  test('rejects wrong length', () => {
    expect(() => decodeStealthMetaAddress('st:sol:' + 'aa'.repeat(60))).toThrow(
      'Invalid stealth meta-address length',
    );
  });

  test('encode rejects wrong key length', () => {
    const shortKey = new Uint8Array(31);
    const keys = deriveStealthKeys(testSig);
    expect(() => encodeStealthMetaAddress(shortKey, keys.viewingPubKey)).toThrow('32 bytes');
  });
});
