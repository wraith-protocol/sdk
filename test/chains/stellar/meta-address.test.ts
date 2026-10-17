import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';
import { deriveStealthKeys } from '../../../src/chains/stellar/keys';
import {
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
} from '../../../src/chains/stellar/meta-address';

const testSig = new Uint8Array(64).fill(0xaa);

describe('meta-address', () => {
  test('encode produces correct format', () => {
    const keys = deriveStealthKeys(testSig);
    const meta = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);

    expect(meta).toMatch(/^st:xlm:[0-9a-f]{128}$/);
  });

  test('encode/decode roundtrip', () => {
    const keys = deriveStealthKeys(testSig);
    const meta = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
    const decoded = decodeStealthMetaAddress(meta);

    expect(decoded.spendingPubKey).toEqual(keys.spendingPubKey);
    expect(decoded.viewingPubKey).toEqual(keys.viewingPubKey);
    expect(decoded.prefix).toBe('st:xlm:');
  });

  test('rejects invalid prefix', () => {
    expect(() => decodeStealthMetaAddress('st:eth:0x' + 'aa'.repeat(64))).toThrow(
      'Invalid stealth meta-address prefix',
    );
  });

  test('rejects wrong length', () => {
    expect(() => decodeStealthMetaAddress('st:xlm:' + 'aa'.repeat(60))).toThrow(
      'Invalid stealth meta-address length',
    );
  });

  test.each(['g', 'G', '-', ' ', '\u00e9'])('rejects non-hex payload character %j', (character) => {
    const keys = deriveStealthKeys(testSig);
    const meta = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
    const malformed = `${meta.slice(0, 7)}${character}${meta.slice(8)}`;

    expect(() => decodeStealthMetaAddress(malformed)).toThrow(
      'Invalid stealth meta-address hex. Expected 128 hexadecimal chars',
    );
  });

  test('rejects invalid hex characters at every payload position', () => {
    const keys = deriveStealthKeys(testSig);
    const meta = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 127 }),
        fc.constantFrom('g', 'G', 'z', '-', ' ', '\u00e9'),
        (index, character) => {
          const payloadIndex = 7 + index;
          const malformed = `${meta.slice(0, payloadIndex)}${character}${meta.slice(payloadIndex + 1)}`;

          expect(() => decodeStealthMetaAddress(malformed)).toThrow(
            'Invalid stealth meta-address hex. Expected 128 hexadecimal chars',
          );
        },
      ),
      { numRuns: 256 },
    );
  });

  test('encode rejects wrong key length', () => {
    const shortKey = new Uint8Array(31);
    const keys = deriveStealthKeys(testSig);
    expect(() => encodeStealthMetaAddress(shortKey, keys.viewingPubKey)).toThrow('32 bytes');
  });
});
