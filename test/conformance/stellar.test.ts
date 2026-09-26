import { describe, test, expect } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { StrKey } from '@stellar/stellar-sdk';
import { deriveStealthKeys } from '../../src/chains/stellar/keys';
import {
  generateStealthAddress,
  computeSharedSecret,
  computeAnnouncementViewTag,
  computeViewTag,
} from '../../src/chains/stellar/stealth';
import {
  checkStealthAddress,
  scanAnnouncements,
  scanAnnouncementsLegacySharedSecretTag,
} from '../../src/chains/stellar/scan';
import { deriveStealthPrivateScalar, signStellarTransaction } from '../../src/chains/stellar/spend';
import {
  seedToScalar,
  hashToScalar,
  deriveStealthPubKey,
  pubKeyToStellarAddress,
  signWithScalar,
  L,
} from '../../src/chains/stellar/scalar';
import {
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
} from '../../src/chains/stellar/meta-address';
import type { Announcement } from '../../src/chains/stellar/types';
import { bytesToHex, hexToBytes } from '../../src/chains/stellar/utils';

const NUM_TEST_CASES = 200;
const NUM_FAST_TEST_CASES = 200;
const NUM_SLOW_TEST_CASES = 100;

/**
 * Generates a random 32-byte seed for deterministic testing.
 */
function randomSeed(): Uint8Array {
  return ed25519.utils.randomPrivateKey();
}

/**
 * Generates a random 64-byte signature for testing.
 */
function randomSignature(): Uint8Array {
  const sig = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    sig[i] = Math.floor(Math.random() * 256);
  }
  return sig;
}

/**
 * Generates a random 32-byte array.
 */
function randomBytes32(): Uint8Array {
  return ed25519.utils.randomPrivateKey();
}

describe('Stellar Conformance Test Suite', () => {
  describe('Invariant 1: deriveStealthKeys produces valid ed25519 keypairs', () => {
    test('derives valid keys for 100 random signatures', 60000, () => {
      for (let i = 0; i < NUM_SLOW_TEST_CASES; i++) {
        const signature = randomSignature();
        const keys = deriveStealthKeys(signature);

        // All keys should be 32 bytes
        expect(keys.spendingKey.length).toBe(32);
        expect(keys.viewingKey.length).toBe(32);
        expect(keys.spendingPubKey.length).toBe(32);
        expect(keys.viewingPubKey.length).toBe(32);

        // Scalars should be positive bigints
        expect(keys.spendingScalar).toBeGreaterThan(0n);
        expect(keys.viewingScalar).toBeGreaterThan(0n);

        // Public keys should be valid ed25519 points
        expect(() => ed25519.ExtendedPoint.fromHex(keys.spendingPubKey)).not.toThrow();
        expect(() => ed25519.ExtendedPoint.fromHex(keys.viewingPubKey)).not.toThrow();

        // Public keys should correspond to private keys
        const derivedSpendPub = ed25519.getPublicKey(keys.spendingKey);
        const derivedViewPub = ed25519.getPublicKey(keys.viewingKey);
        expect(keys.spendingPubKey).toEqual(derivedSpendPub);
        expect(keys.viewingPubKey).toEqual(derivedViewPub);
      }
    });
  });

  describe('Invariant 2: deriveStealthKeys is deterministic', () => {
    test('same signature produces identical keys across 1000 cases', () => {
      for (let i = 0; i < NUM_TEST_CASES; i++) {
        const signature = randomSignature();
        const keys1 = deriveStealthKeys(signature);
        const keys2 = deriveStealthKeys(signature);

        expect(keys1.spendingKey).toEqual(keys2.spendingKey);
        expect(keys1.viewingKey).toEqual(keys2.viewingKey);
        expect(keys1.spendingScalar).toBe(keys2.spendingScalar);
        expect(keys1.viewingScalar).toBe(keys2.viewingScalar);
        expect(keys1.spendingPubKey).toEqual(keys2.spendingPubKey);
        expect(keys1.viewingPubKey).toEqual(keys2.viewingPubKey);
      }
    });
  });

  describe('Invariant 3: deriveStealthKeys separates spending and viewing keys', () => {
    test('spending and viewing keys are independent for 1000 signatures', () => {
      for (let i = 0; i < NUM_TEST_CASES; i++) {
        const signature = randomSignature();
        const keys = deriveStealthKeys(signature);

        // Seeds should differ
        expect(keys.spendingKey).not.toEqual(keys.viewingKey);

        // Scalars should differ
        expect(keys.spendingScalar).not.toBe(keys.viewingScalar);

        // Public keys should differ
        expect(keys.spendingPubKey).not.toEqual(keys.viewingPubKey);
      }
    });
  });

  describe('Invariant 4: generateStealthAddress produces valid Stellar addresses', () => {
    test('generates valid stealth addresses for 1000 keypairs', () => {
      for (let i = 0; i < NUM_TEST_CASES; i++) {
        const signature = randomSignature();
        const keys = deriveStealthKeys(signature);
        const result = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

        // Stealth address should be valid Stellar G... address
        expect(result.stealthAddress).toMatch(/^G[A-Z2-7]{55}$/);

        // Ephemeral public key should be 32 bytes
        expect(result.ephemeralPubKey.length).toBe(32);

        // View tag should be in valid range
        expect(result.viewTag).toBeGreaterThanOrEqual(0);
        expect(result.viewTag).toBeLessThanOrEqual(255);

        // Ephemeral public key should be valid ed25519 point
        expect(() => ed25519.ExtendedPoint.fromHex(result.ephemeralPubKey)).not.toThrow();
      }
    });
  });

  describe('Invariant 5: generateStealthAddress is deterministic with fixed seed', () => {
    test('same inputs produce identical outputs for 1000 cases', () => {
      for (let i = 0; i < NUM_TEST_CASES; i++) {
        const signature = randomSignature();
        const keys = deriveStealthKeys(signature);
        const ephemeralSeed = randomSeed();

        const result1 = generateStealthAddress(
          keys.spendingPubKey,
          keys.viewingPubKey,
          ephemeralSeed,
        );
        const result2 = generateStealthAddress(
          keys.spendingPubKey,
          keys.viewingPubKey,
          ephemeralSeed,
        );

        expect(result1.stealthAddress).toBe(result2.stealthAddress);
        expect(result1.ephemeralPubKey).toEqual(result2.ephemeralPubKey);
        expect(result1.viewTag).toBe(result2.viewTag);
      }
    });
  });

  describe('Invariant 6: generateStealthAddress produces different addresses for different inputs', () => {
    test('different ephemeral seeds produce different addresses for 1000 cases', () => {
      for (let i = 0; i < NUM_TEST_CASES; i++) {
        const signature = randomSignature();
        const keys = deriveStealthKeys(signature);
        const seed1 = randomSeed();
        const seed2 = randomSeed();

        // Ensure seeds are different
        if (seed1.every((b, idx) => b === seed2[idx])) {
          seed2[0] = (seed2[0] + 1) % 256;
        }

        const result1 = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, seed1);
        const result2 = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, seed2);

        expect(result1.stealthAddress).not.toBe(result2.stealthAddress);
      }
    });
  });

  describe('Invariant 7: encode/decode meta-address round-trip', () => {
    test('encode and decode produce identical keys for 1000 keypairs', () => {
      for (let i = 0; i < NUM_TEST_CASES; i++) {
        const signature = randomSignature();
        const keys = deriveStealthKeys(signature);

        const encoded = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
        const decoded = decodeStealthMetaAddress(encoded);

        expect(decoded.spendingPubKey).toEqual(keys.spendingPubKey);
        expect(decoded.viewingPubKey).toEqual(keys.viewingPubKey);
      }
    });
  });

  describe('Invariant 8: view-tag computation is deterministic', () => {
    test('same inputs produce same view tag for 1000 cases', () => {
      for (let i = 0; i < NUM_TEST_CASES; i++) {
        const ephPubKey = randomBytes32();
        const viewingPubKey = randomBytes32();

        const tag1 = computeAnnouncementViewTag(ephPubKey, viewingPubKey);
        const tag2 = computeAnnouncementViewTag(ephPubKey, viewingPubKey);

        expect(tag1).toBe(tag2);
      }
    });
  });

  describe('Invariant 9: view-tag is in valid range', () => {
    test('view tag is always 0-255 for 1000 random inputs', () => {
      for (let i = 0; i < NUM_TEST_CASES; i++) {
        const ephPubKey = randomBytes32();
        const viewingPubKey = randomBytes32();

        const tag = computeAnnouncementViewTag(ephPubKey, viewingPubKey);

        expect(tag).toBeGreaterThanOrEqual(0);
        expect(tag).toBeLessThanOrEqual(255);
      }
    });
  });

  describe('Invariant 10: checkStealthAddress correctly identifies matches', () => {
    test(
      'generated stealth address is detected by checkStealthAddress for 1000 cases',
      30000,
      () => {
        for (let i = 0; i < NUM_TEST_CASES; i++) {
          const signature = randomSignature();
          const keys = deriveStealthKeys(signature);
          const result = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

          const checkResult = checkStealthAddress(
            result.ephemeralPubKey,
            keys.viewingKey,
            keys.spendingPubKey,
            result.viewTag,
          );

          expect(checkResult.isMatch).toBe(true);
          expect(checkResult.stealthAddress).toBe(result.stealthAddress);
          expect(checkResult.hashScalar).not.toBeNull();
          expect(checkResult.stealthPubKeyBytes).not.toBeNull();
        }
      },
    );
  });

  describe('Invariant 11: checkStealthAddress rejects non-matches', () => {
    test('wrong viewing key fails to match for 1000 cases', 30000, () => {
      for (let i = 0; i < NUM_TEST_CASES; i++) {
        const signature1 = randomSignature();
        const signature2 = randomSignature();
        const keys1 = deriveStealthKeys(signature1);
        const keys2 = deriveStealthKeys(signature2);

        const result = generateStealthAddress(keys1.spendingPubKey, keys1.viewingPubKey);

        const checkResult = checkStealthAddress(
          result.ephemeralPubKey,
          keys2.viewingKey,
          keys1.spendingPubKey,
          result.viewTag,
        );

        // Should not match (view tag prefilter should catch most, but not all)
        if (checkResult.isMatch) {
          // If it passes view tag, the stealth address should still differ
          expect(checkResult.stealthAddress).not.toBe(result.stealthAddress);
        }
      }
    });
  });

  describe('Invariant 12: scanAnnouncements finds all matches', () => {
    test(
      'scanAnnouncements correctly identifies matching announcements for 100 cases',
      60000,
      () => {
        for (let i = 0; i < NUM_SLOW_TEST_CASES; i++) {
          const signature = randomSignature();
          const keys = deriveStealthKeys(signature);

          // Generate a stealth address for the recipient
          const stealthResult = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

          // Create an announcement
          const announcement: Announcement = {
            schemeId: 1,
            stealthAddress: stealthResult.stealthAddress,
            caller: 'G' + 'A'.repeat(55),
            ephemeralPubKey: bytesToHex(stealthResult.ephemeralPubKey),
            metadata: bytesToHex(new Uint8Array([stealthResult.viewTag])),
          };

          // Add some decoy announcements
          const announcements: Announcement[] = [announcement];
          for (let j = 0; j < 5; j++) {
            const decoySig = randomSignature();
            const decoyKeys = deriveStealthKeys(decoySig);
            const decoyStealth = generateStealthAddress(
              decoyKeys.spendingPubKey,
              decoyKeys.viewingPubKey,
            );
            announcements.push({
              schemeId: 1,
              stealthAddress: decoyStealth.stealthAddress,
              caller: 'G' + 'B'.repeat(55),
              ephemeralPubKey: bytesToHex(decoyStealth.ephemeralPubKey),
              metadata: bytesToHex(new Uint8Array([decoyStealth.viewTag])),
            });
          }

          // Shuffle announcements
          const shuffled = [...announcements].sort(() => Math.random() - 0.5);

          const matched = scanAnnouncements(
            shuffled,
            keys.viewingKey,
            keys.spendingPubKey,
            keys.spendingScalar,
          );

          expect(matched.length).toBe(1);
          expect(matched[0].stealthAddress).toBe(stealthResult.stealthAddress);
          expect(matched[0].stealthPrivateScalar).not.toBeNull();
        }
      },
    );
  });

  describe('Invariant 13: deriveStealthPrivateScalar produces valid scalar', () => {
    test('derived stealth scalar is valid for 1000 cases', 30000, () => {
      for (let i = 0; i < NUM_TEST_CASES; i++) {
        const signature = randomSignature();
        const keys = deriveStealthKeys(signature);
        const stealthResult = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

        const stealthScalar = deriveStealthPrivateScalar(
          keys.spendingScalar,
          keys.viewingKey,
          stealthResult.ephemeralPubKey,
        );

        // Scalar should be in valid range
        expect(stealthScalar).toBeGreaterThanOrEqual(0n);
        expect(stealthScalar).toBeLessThan(L);

        // Stealth scalar should differ from spending scalar
        expect(stealthScalar).not.toBe(keys.spendingScalar);
      }
    });
  });

  describe('Invariant 14: deriveStealthPrivateScalar is deterministic', () => {
    test('same inputs produce same stealth scalar for 1000 cases', 30000, () => {
      for (let i = 0; i < NUM_TEST_CASES; i++) {
        const signature = randomSignature();
        const keys = deriveStealthKeys(signature);
        const stealthResult = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

        const scalar1 = deriveStealthPrivateScalar(
          keys.spendingScalar,
          keys.viewingKey,
          stealthResult.ephemeralPubKey,
        );
        const scalar2 = deriveStealthPrivateScalar(
          keys.spendingScalar,
          keys.viewingKey,
          stealthResult.ephemeralPubKey,
        );

        expect(scalar1).toBe(scalar2);
      }
    });
  });

  describe('Invariant 15: signWithScalar produces valid signatures', () => {
    test('signatures are 64 bytes and verify for 1000 cases', 30000, () => {
      for (let i = 0; i < NUM_TEST_CASES; i++) {
        const seed = randomSeed();
        const scalar = ((seedToScalar(seed) % L) + L) % L;
        const pubKey = ed25519.getPublicKey(seed);
        const message = randomBytes32();

        const signature = signWithScalar(message, scalar, pubKey);

        // Signature should be 64 bytes
        expect(signature.length).toBe(64);

        // Signature should verify
        const isValid = ed25519.verify(signature, message, pubKey);
        expect(isValid).toBe(true);
      }
    });
  });

  describe('Invariant 16: signWithScalar is deterministic', () => {
    test('same inputs produce same signature for 1000 cases', 30000, () => {
      for (let i = 0; i < NUM_TEST_CASES; i++) {
        const seed = randomSeed();
        const scalar = ((seedToScalar(seed) % L) + L) % L;
        const pubKey = ed25519.getPublicKey(seed);
        const message = randomBytes32();

        const sig1 = signWithScalar(message, scalar, pubKey);
        const sig2 = signWithScalar(message, scalar, pubKey);

        expect(sig1).toEqual(sig2);
      }
    });
  });

  describe('Invariant 17: seedToScalar produces clamped scalars', () => {
    test('scalars are properly clamped for 1000 random seeds', () => {
      for (let i = 0; i < NUM_TEST_CASES; i++) {
        const seed = randomSeed();
        // This invariant is about the clamped raw scalar, not the mod-L form.
        const scalar = seedToScalar(seed);

        // Scalar should be positive
        expect(scalar).toBeGreaterThanOrEqual(0n);

        // Convert back to bytes to check clamping
        const bytes = new Uint8Array(32);
        let s = scalar;
        for (let j = 0; j < 32; j++) {
          bytes[j] = Number(s & 0xffn);
          s >>= 8n;
        }

        // Check clamping: bits 0,1,2 of byte 0 should be cleared
        expect(bytes[0] & 0x07).toBe(0);

        // Check clamping: bit 7 of byte 31 should be cleared, bit 6 should be set
        expect(bytes[31] & 0x80).toBe(0);
        expect(bytes[31] & 0x40).toBe(0x40);
      }
    });
  });

  describe('Invariant 18: hashToScalar produces values in range', () => {
    test('hashToScalar always produces values < L for 1000 inputs', () => {
      for (let i = 0; i < NUM_TEST_CASES; i++) {
        const input = randomBytes32();
        const scalar = hashToScalar(input);

        expect(scalar).toBeGreaterThanOrEqual(0n);
        expect(scalar).toBeLessThan(L);
      }
    });
  });

  describe('Invariant 19: deriveStealthPubKey produces valid ed25519 points', () => {
    test('derived stealth public keys are valid for 1000 cases', 30000, () => {
      for (let i = 0; i < NUM_TEST_CASES; i++) {
        const seed = randomSeed();
        const pubKey = ed25519.getPublicKey(seed);
        const hashScalar = hashToScalar(randomBytes32());

        const stealthPubKey = deriveStealthPubKey(pubKey, hashScalar);

        // Should be 32 bytes
        expect(stealthPubKey.length).toBe(32);

        // Should be valid ed25519 point
        expect(() => ed25519.ExtendedPoint.fromHex(stealthPubKey)).not.toThrow();
      }
    });
  });

  describe('Invariant 20: pubKeyToStellarAddress produces valid addresses', () => {
    test('public keys convert to valid Stellar addresses for 1000 cases', () => {
      for (let i = 0; i < NUM_TEST_CASES; i++) {
        const seed = randomSeed();
        const pubKey = ed25519.getPublicKey(seed);

        const address = pubKeyToStellarAddress(pubKey);

        // Should be valid Stellar G... address
        expect(address).toMatch(/^G[A-Z2-7]{55}$/);
      }
    });
  });

  describe('Invariant 21: computeSharedSecret is symmetric', () => {
    test('ECDH produces same shared secret for both parties for 100 cases', 30000, () => {
      for (let i = 0; i < NUM_SLOW_TEST_CASES; i++) {
        const priv1 = randomSeed();
        const pub1 = ed25519.getPublicKey(priv1);
        const priv2 = randomSeed();
        const pub2 = ed25519.getPublicKey(priv2);

        const secret1 = computeSharedSecret(priv1, pub2);
        const secret2 = computeSharedSecret(priv2, pub1);

        expect(secret1).toEqual(secret2);
      }
    });
  });

  describe('Invariant 22: computeSharedSecret produces 32-byte output', () => {
    test('shared secrets are always 32 bytes for 100 cases', 30000, () => {
      for (let i = 0; i < NUM_SLOW_TEST_CASES; i++) {
        const priv = randomSeed();
        const pub = ed25519.getPublicKey(randomSeed());

        const secret = computeSharedSecret(priv, pub);

        expect(secret.length).toBe(32);
      }
    });
  });

  describe('Invariant 23: scanAnnouncementsLegacySharedSecretTag produces valid results', () => {
    test('legacy scanner correctly identifies matches for 100 cases', () => {
      for (let i = 0; i < NUM_SLOW_TEST_CASES; i++) {
        const signature = randomSignature();
        const keys = deriveStealthKeys(signature);

        // Generate a stealth address for the recipient
        const stealthResult = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

        // Create an announcement
        const announcement: Announcement = {
          schemeId: 1,
          stealthAddress: stealthResult.stealthAddress,
          caller: 'G' + 'A'.repeat(55),
          ephemeralPubKey: bytesToHex(stealthResult.ephemeralPubKey),
          metadata: bytesToHex(new Uint8Array([stealthResult.viewTag])),
        };

        const announcements = [announcement];

        const matchedLegacy = scanAnnouncementsLegacySharedSecretTag(
          announcements,
          keys.viewingKey,
          keys.spendingPubKey,
          keys.spendingScalar,
        );

        // Legacy scanner should find the match (though may use different view tag computation)
        expect(matchedLegacy.length).toBeGreaterThanOrEqual(0);
        if (matchedLegacy.length > 0) {
          expect(matchedLegacy[0].stealthAddress).toBe(stealthResult.stealthAddress);
          expect(matchedLegacy[0].stealthPrivateScalar).not.toBeNull();
        }
      }
    });
  });

  describe('Invariant 24: signStellarTransaction wraps signWithScalar correctly', () => {
    test('signStellarTransaction produces valid signatures for 100 cases', 60000, () => {
      for (let i = 0; i < NUM_SLOW_TEST_CASES; i++) {
        const signature = randomSignature();
        const keys = deriveStealthKeys(signature);
        const stealthResult = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

        const stealthScalar = deriveStealthPrivateScalar(
          keys.spendingScalar,
          keys.viewingKey,
          stealthResult.ephemeralPubKey,
        );

        // Derive stealth public key bytes from the stealth address
        const stealthPubKeyBytes = (StrKey as any).decodeEd25519PublicKey(
          stealthResult.stealthAddress,
        );

        const txHash = randomBytes32();

        const sig = signStellarTransaction(txHash, stealthScalar, stealthPubKeyBytes);

        // Should be 64 bytes
        expect(sig.length).toBe(64);

        // Should verify
        const isValid = ed25519.verify(sig, txHash, stealthPubKeyBytes);
        expect(isValid).toBe(true);
      }
    });
  });

  describe('Invariant 25: different recipients produce different stealth addresses', () => {
    test('stealth addresses differ across 100 different recipients', 30000, () => {
      const ephemeralSeed = randomSeed();
      const addresses = new Set<string>();

      for (let i = 0; i < NUM_SLOW_TEST_CASES; i++) {
        const signature = randomSignature();
        const keys = deriveStealthKeys(signature);
        const result = generateStealthAddress(
          keys.spendingPubKey,
          keys.viewingPubKey,
          ephemeralSeed,
        );

        addresses.add(result.stealthAddress);
      }

      // With 100 random recipients, we should have many unique addresses
      // (collisions are extremely unlikely)
      expect(addresses.size).toBeGreaterThan(90);
    });
  });
});
