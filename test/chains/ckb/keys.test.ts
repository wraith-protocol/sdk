import { describe, test, expect } from 'vitest';
import { deriveStealthKeys } from '../../../src/chains/ckb/keys';
import type { HexString } from '../../../src/chains/ckb/types';

const testSig = ('0x' + 'aa'.repeat(32) + 'bb'.repeat(32) + '1b') as HexString;

describe('deriveStealthKeys', () => {
  test('derives valid keys from signature', () => {
    const keys = deriveStealthKeys(testSig);

    expect(keys.spendingKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(keys.viewingKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(keys.spendingPubKey).toMatch(/^0x(02|03)[0-9a-f]{64}$/);
    expect(keys.viewingPubKey).toMatch(/^0x(02|03)[0-9a-f]{64}$/);
  });

  test('deterministic derivation', () => {
    const keys1 = deriveStealthKeys(testSig);
    const keys2 = deriveStealthKeys(testSig);

    expect(keys1.spendingKey).toBe(keys2.spendingKey);
    expect(keys1.viewingKey).toBe(keys2.viewingKey);
  });

  test('spending key differs from viewing key', () => {
    const keys = deriveStealthKeys(testSig);
    expect(keys.spendingKey).not.toBe(keys.viewingKey);
  });

  test('rejects wrong signature length', () => {
    const short = ('0x' + 'aa'.repeat(64)) as HexString;
    expect(() => deriveStealthKeys(short)).toThrow('Expected 65-byte signature');
  });
});
