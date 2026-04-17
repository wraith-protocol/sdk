import { describe, test, expect } from 'vitest';
import { deriveStealthKeys } from '../../../src/chains/ckb/keys';
import { generateStealthAddress } from '../../../src/chains/ckb/stealth';
import type { HexString } from '../../../src/chains/ckb/types';

const testSig = ('0x' + 'aa'.repeat(32) + 'bb'.repeat(32) + '1b') as HexString;
const fixedEphKey = ('0x' + 'cc'.repeat(32)) as HexString;

describe('generateStealthAddress', () => {
  test('generates valid stealth address', () => {
    const keys = deriveStealthKeys(testSig);
    const result = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedEphKey);

    expect(result.stealthPubKey).toMatch(/^0x(02|03)[0-9a-f]{64}$/);
    expect(result.stealthPubKeyHash).toMatch(/^0x[0-9a-f]{40}$/);
    expect(result.ephemeralPubKey).toMatch(/^0x(02|03)[0-9a-f]{64}$/);
    expect(result.lockArgs).toMatch(/^0x[0-9a-f]{106}$/);
  });

  test('lockArgs is exactly 53 bytes', () => {
    const keys = deriveStealthKeys(testSig);
    const result = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedEphKey);

    // 0x prefix + 53 bytes * 2 hex chars = 108 total chars
    expect(result.lockArgs.length).toBe(108);
  });

  test('lockArgs contains ephemeral pubkey and blake160 hash', () => {
    const keys = deriveStealthKeys(testSig);
    const result = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedEphKey);

    const ephFromArgs = '0x' + result.lockArgs.slice(2, 68);
    const hashFromArgs = '0x' + result.lockArgs.slice(68);

    expect(ephFromArgs).toBe(result.ephemeralPubKey);
    expect(hashFromArgs).toBe(result.stealthPubKeyHash);
  });

  test('deterministic with fixed ephemeral key', () => {
    const keys = deriveStealthKeys(testSig);
    const r1 = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedEphKey);
    const r2 = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedEphKey);

    expect(r1.lockArgs).toBe(r2.lockArgs);
    expect(r1.stealthPubKey).toBe(r2.stealthPubKey);
  });

  test('different recipients produce different addresses', () => {
    const keys1 = deriveStealthKeys(testSig);
    const sig2 = ('0x' + '11'.repeat(32) + '22'.repeat(32) + '1c') as HexString;
    const keys2 = deriveStealthKeys(sig2);

    const r1 = generateStealthAddress(keys1.spendingPubKey, keys1.viewingPubKey, fixedEphKey);
    const r2 = generateStealthAddress(keys2.spendingPubKey, keys2.viewingPubKey, fixedEphKey);

    expect(r1.lockArgs).not.toBe(r2.lockArgs);
  });
});
