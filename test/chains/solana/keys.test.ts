import { describe, test, expect } from 'vitest';
import { deriveStealthKeys } from '../../../src/chains/solana/keys';

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
    expect(() => deriveStealthKeys(short)).toThrow('Expected 64-byte');
  });

  test('rejects wrong signature length (65 bytes)', () => {
    const long = new Uint8Array(65).fill(0xaa);
    expect(() => deriveStealthKeys(long)).toThrow('Expected 64-byte');
  });
});
