import { InvalidSignatureError } from '../../../src/errors';
import { describe, test, expect } from 'vitest';
import { deriveStealthKeys } from '../../../src/chains/stellar/keys';
import { scalarToBytes } from '../../../src/chains/stellar/scalar';

const testSig = new Uint8Array(64).fill(0xaa);

describe('deriveStealthKeys', () => {
  test('derives valid keys from signature', () => {
    const keys = deriveStealthKeys(testSig);

    expect(keys.spendingKey).toBeInstanceOf(Uint8Array);
    expect(keys.spendingKey.length).toBe(32);
    expect(keys.viewingKey).toBeInstanceOf(Uint8Array);
    expect(keys.viewingKey.length).toBe(32);
    expect(keys.spendingPubKey.length).toBe(32);
    expect(keys.viewingPubKey.length).toBe(32);
    expect(typeof keys.spendingScalar).toBe('bigint');
    expect(typeof keys.viewingScalar).toBe('bigint');
    expect(keys.spendingScalar > 0n).toBe(true);
    expect(keys.viewingScalar > 0n).toBe(true);
  });

  test('deterministic derivation', () => {
    const keys1 = deriveStealthKeys(testSig);
    const keys2 = deriveStealthKeys(testSig);

    expect(keys1.spendingKey).toEqual(keys2.spendingKey);
    expect(keys1.viewingKey).toEqual(keys2.viewingKey);
    expect(keys1.spendingPubKey).toEqual(keys2.spendingPubKey);
    expect(keys1.viewingPubKey).toEqual(keys2.viewingPubKey);
    expect(keys1.spendingScalar).toBe(keys2.spendingScalar);
    expect(keys1.viewingScalar).toBe(keys2.viewingScalar);
  });

  test('spending key differs from viewing key', () => {
    const keys = deriveStealthKeys(testSig);

    const spendHex = Array.from(keys.spendingKey)
      .map((b) => b.toString(16))
      .join('');
    const viewHex = Array.from(keys.viewingKey)
      .map((b) => b.toString(16))
      .join('');
    expect(spendHex).not.toBe(viewHex);
  });

  test('rejects wrong signature length (63 bytes)', () => {
    const short = new Uint8Array(63).fill(0xaa);
    expect(() => deriveStealthKeys(short)).toThrow(InvalidSignatureError);
  });

  test('rejects wrong signature length (65 bytes)', () => {
    const long = new Uint8Array(65).fill(0xaa);
    expect(() => deriveStealthKeys(long)).toThrow(InvalidSignatureError);
  });

  test('domain separation: spending and viewing keys are independent', () => {
    const keys = deriveStealthKeys(testSig);
    // These should never be equal due to domain-separated SHA-256
    const spendingHex = Array.from(keys.spendingKey)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const viewingHex = Array.from(keys.viewingKey)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(spendingHex).not.toBe(viewingHex);
  });

  test('derived scalars are properly clamped (bit 254 set)', () => {
    const keys = deriveStealthKeys(testSig);
    // In ed25519, clamping sets bit 6 of byte 31 (0x40) → bit 254 of the scalar
    const bytes = scalarToBytes(keys.spendingScalar);
    expect(bytes[31] & 0x40).toBe(0x40);
    // Bits 0,1,2 of byte 0 should be cleared
    expect(bytes[0] & 0x07).toBe(0);
  });
});
