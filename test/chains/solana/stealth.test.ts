import { describe, test, expect } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { deriveStealthKeys } from '../../../src/chains/solana/keys';
import { generateStealthAddress } from '../../../src/chains/solana/stealth';

const testSig = new Uint8Array(64).fill(0xaa);
const fixedSeed = new Uint8Array(32).fill(0xcc);

describe('generateStealthAddress', () => {
  test('generates valid stealth address', () => {
    const keys = deriveStealthKeys(testSig);
    const result = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedSeed);

    expect(result.ephemeralPubKey).toBeInstanceOf(Uint8Array);
    expect(result.ephemeralPubKey.length).toBe(32);
    expect(result.viewTag).toBeGreaterThanOrEqual(0);
    expect(result.viewTag).toBeLessThanOrEqual(255);
    expect(() => new PublicKey(result.stealthAddress)).not.toThrow();
  });

  test('deterministic with fixed ephemeral seed', () => {
    const keys = deriveStealthKeys(testSig);
    const r1 = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedSeed);
    const r2 = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedSeed);

    expect(r1.stealthAddress).toBe(r2.stealthAddress);
    expect(r1.ephemeralPubKey).toEqual(r2.ephemeralPubKey);
    expect(r1.viewTag).toBe(r2.viewTag);
  });

  test('different ephemeral seeds produce different addresses', () => {
    const keys = deriveStealthKeys(testSig);
    const r1 = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedSeed);
    const altSeed = new Uint8Array(32).fill(0xdd);
    const r2 = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, altSeed);

    expect(r1.stealthAddress).not.toBe(r2.stealthAddress);
  });

  test('different recipients produce different addresses', () => {
    const keys1 = deriveStealthKeys(testSig);
    const sig2 = new Uint8Array(64).fill(0xbb);
    const keys2 = deriveStealthKeys(sig2);

    const r1 = generateStealthAddress(keys1.spendingPubKey, keys1.viewingPubKey, fixedSeed);
    const r2 = generateStealthAddress(keys2.spendingPubKey, keys2.viewingPubKey, fixedSeed);

    expect(r1.stealthAddress).not.toBe(r2.stealthAddress);
  });

  test('address is valid base58 Solana address', () => {
    const keys = deriveStealthKeys(testSig);
    const result = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedSeed);

    const pubkey = new PublicKey(result.stealthAddress);
    expect(pubkey.toBytes().length).toBe(32);
  });
});
