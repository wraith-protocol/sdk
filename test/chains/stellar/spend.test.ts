import { describe, test, expect } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { deriveStealthKeys } from '../../../src/chains/stellar/keys';
import { generateStealthAddress } from '../../../src/chains/stellar/stealth';
import {
  deriveStealthPrivateScalar,
  signStellarTransaction,
} from '../../../src/chains/stellar/spend';
import { pubKeyToStellarAddress, L } from '../../../src/chains/stellar/scalar';

const testSig = new Uint8Array(64).fill(0xaa);
const fixedSeed = new Uint8Array(32).fill(0xcc);

describe('deriveStealthPrivateScalar', () => {
  test('returns a valid bigint scalar', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedSeed);

    const scalar = deriveStealthPrivateScalar(
      keys.spendingScalar,
      keys.viewingKey,
      stealth.ephemeralPubKey,
    );

    expect(typeof scalar).toBe('bigint');
    expect(scalar > 0n).toBe(true);
  });

  test('derived scalar produces the stealth public key', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedSeed);

    const scalar = deriveStealthPrivateScalar(
      keys.spendingScalar,
      keys.viewingKey,
      stealth.ephemeralPubKey,
    );

    const derivedPub = ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes();
    const derivedAddress = pubKeyToStellarAddress(derivedPub);

    expect(derivedAddress).toBe(stealth.stealthAddress);
  });

  test('deterministic', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedSeed);

    const s1 = deriveStealthPrivateScalar(
      keys.spendingScalar,
      keys.viewingKey,
      stealth.ephemeralPubKey,
    );
    const s2 = deriveStealthPrivateScalar(
      keys.spendingScalar,
      keys.viewingKey,
      stealth.ephemeralPubKey,
    );

    expect(s1).toBe(s2);
  });

  test('always produces non-zero scalar', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedSeed);

    const scalar = deriveStealthPrivateScalar(
      keys.spendingScalar,
      keys.viewingKey,
      stealth.ephemeralPubKey,
    );

    // The stealth scalar should always be > 0 and < L
    expect(scalar).toBeGreaterThan(0n);
    expect(scalar).toBeLessThan(L);
  });
});

describe('signStellarTransaction', () => {
  test('produces valid ed25519 signature verified by @noble/curves', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedSeed);
    const stealthScalar = deriveStealthPrivateScalar(
      keys.spendingScalar,
      keys.viewingKey,
      stealth.ephemeralPubKey,
    );
    const stealthPubKey = ed25519.ExtendedPoint.BASE.multiply(stealthScalar).toRawBytes();

    const txHash = new Uint8Array(32).fill(0xdd);
    const sig = signStellarTransaction(txHash, stealthScalar, stealthPubKey);

    expect(sig.length).toBe(64);
    const verified = ed25519.verify(sig, txHash, stealthPubKey);
    expect(verified).toBe(true);
  });
});
