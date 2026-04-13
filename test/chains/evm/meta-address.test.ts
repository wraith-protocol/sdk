import { describe, test, expect } from 'vitest';
import { deriveStealthKeys } from '../../../src/chains/evm/keys';
import {
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
} from '../../../src/chains/evm/meta-address';
import type { HexString } from '../../../src/chains/evm/types';

const testSig = ('0x' + 'aa'.repeat(32) + 'bb'.repeat(32) + '1b') as HexString;

describe('meta-address', () => {
  test('encode produces correct format', () => {
    const keys = deriveStealthKeys(testSig);
    const meta = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);

    expect(meta).toMatch(/^st:eth:0x[0-9a-f]{132}$/);
  });

  test('encode/decode roundtrip', () => {
    const keys = deriveStealthKeys(testSig);
    const meta = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
    const decoded = decodeStealthMetaAddress(meta);

    expect(decoded.spendingPubKey).toBe(keys.spendingPubKey);
    expect(decoded.viewingPubKey).toBe(keys.viewingPubKey);
    expect(decoded.prefix).toBe('st:eth:0x');
  });

  test('rejects invalid prefix', () => {
    expect(() => decodeStealthMetaAddress('st:xlm:0x' + 'aa'.repeat(66))).toThrow(
      'Invalid stealth meta-address prefix',
    );
  });

  test('rejects wrong length', () => {
    expect(() => decodeStealthMetaAddress('st:eth:0x' + 'aa'.repeat(60))).toThrow(
      'Invalid stealth meta-address length',
    );
  });

  test('encode rejects wrong key length', () => {
    const shortKey = ('0x' + 'aa'.repeat(32)) as HexString;
    const keys = deriveStealthKeys(testSig);
    expect(() => encodeStealthMetaAddress(shortKey, keys.viewingPubKey)).toThrow('33 bytes');
  });
});
