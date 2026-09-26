import { describe, test, expect, vi } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1';
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

  test('decode rejects malformed (off-curve) public key point', () => {
    const badPoint = '02' + 'ff'.repeat(32);
    const malformed = 'st:eth:0x' + badPoint + badPoint;

    expect(() => decodeStealthMetaAddress(malformed)).toThrow(
      'Invalid public key points inside meta-address',
    );
  });

  test('decode wraps non-Error throw from point parsing', () => {
    const keys = deriveStealthKeys(testSig);
    const meta = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);

    const spy = vi.spyOn(secp256k1.ProjectivePoint, 'fromHex').mockImplementation(() => {
      throw 'not an Error instance';
    });

    expect(() => decodeStealthMetaAddress(meta)).toThrow(
      'Invalid public key points inside meta-address',
    );
    expect(() => decodeStealthMetaAddress(meta)).toThrow('not an Error instance');

    spy.mockRestore();
  });

  test('encode wraps non-Error throw from point parsing', () => {
    const keys = deriveStealthKeys(testSig);
    const spy = vi.spyOn(secp256k1.ProjectivePoint, 'fromHex').mockImplementation(() => {
      throw { code: 'WEIRD', detail: 'plain object throw' };
    });

    expect(() => encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey)).toThrow(
      'Invalid public key points',
    );

    spy.mockRestore();
  });
});
