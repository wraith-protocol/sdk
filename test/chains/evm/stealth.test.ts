import { describe, test, expect } from 'vitest';
import { deriveStealthKeys } from '../../../src/chains/evm/keys';
import { generateStealthAddress } from '../../../src/chains/evm/stealth';
import { getAddress } from 'viem';
import type { HexString } from '../../../src/chains/evm/types';

const testSig = ('0x' + 'aa'.repeat(32) + 'bb'.repeat(32) + '1b') as HexString;
const fixedEphKey = ('0x' + 'cc'.repeat(32)) as HexString;

describe('generateStealthAddress', () => {
  test('generates valid stealth address', () => {
    const keys = deriveStealthKeys(testSig);
    const result = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedEphKey);

    expect(result.stealthAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(result.ephemeralPubKey).toMatch(/^0x(02|03)[0-9a-f]{64}$/);
    expect(result.viewTag).toBeGreaterThanOrEqual(0);
    expect(result.viewTag).toBeLessThanOrEqual(255);
  });

  test('deterministic with fixed ephemeral key', () => {
    const keys = deriveStealthKeys(testSig);
    const r1 = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedEphKey);
    const r2 = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedEphKey);

    expect(r1.stealthAddress).toBe(r2.stealthAddress);
    expect(r1.ephemeralPubKey).toBe(r2.ephemeralPubKey);
    expect(r1.viewTag).toBe(r2.viewTag);
  });

  test('different ephemeral keys produce different addresses', () => {
    const keys = deriveStealthKeys(testSig);
    const r1 = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedEphKey);
    const altEph = ('0x' + 'dd'.repeat(32)) as HexString;
    const r2 = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, altEph);

    expect(r1.stealthAddress).not.toBe(r2.stealthAddress);
  });

  test('different recipients produce different addresses', () => {
    const keys1 = deriveStealthKeys(testSig);
    const sig2 = ('0x' + '11'.repeat(32) + '22'.repeat(32) + '1c') as HexString;
    const keys2 = deriveStealthKeys(sig2);

    const r1 = generateStealthAddress(keys1.spendingPubKey, keys1.viewingPubKey, fixedEphKey);
    const r2 = generateStealthAddress(keys2.spendingPubKey, keys2.viewingPubKey, fixedEphKey);

    expect(r1.stealthAddress).not.toBe(r2.stealthAddress);
  });

  test('address is valid EVM address', () => {
    const keys = deriveStealthKeys(testSig);
    const result = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedEphKey);

    expect(() => getAddress(result.stealthAddress)).not.toThrow();
  });
});
