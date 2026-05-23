import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { computeViewTag } from '../../../src/chains/stellar/stealth';
import {
  L,
  bytesToScalar,
  deriveStealthPubKey,
  scalarToBytes,
  seedToScalar,
  signWithScalar,
} from '../../../src/chains/stellar/scalar';

const configuredRuns = Number(process.env.WRAITH_FUZZ_RUNS ?? '1000');
const propertyRuns = Number.isFinite(configuredRuns) && configuredRuns > 0 ? configuredRuns : 1000;
const propertyOptions = { numRuns: propertyRuns };
const scalarArbitrary = fc.bigInt({ min: 1n, max: L - 1n });
const seedArbitrary = fc.uint8Array({ minLength: 32, maxLength: 32 });
const messageArbitrary = fc.uint8Array({ minLength: 0, maxLength: 256 });

function addMod(a: bigint, b: bigint) {
  return (a + b) % L;
}

function publicKeyFromScalar(scalar: bigint) {
  return ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes();
}

function deterministicSecret(index: number) {
  const input = new Uint8Array(4);
  new DataView(input.buffer).setUint32(0, index, true);
  return sha256(input);
}

describe('Stellar scalar property tests', () => {
  test('addition is associative modulo L', () => {
    fc.assert(
      fc.property(scalarArbitrary, scalarArbitrary, scalarArbitrary, (a, b, c) => {
        expect(addMod(addMod(a, b), c)).toBe(addMod(a, addMod(b, c)));
      }),
      propertyOptions,
    );
  });

  test('addition is commutative modulo L', () => {
    fc.assert(
      fc.property(scalarArbitrary, scalarArbitrary, (a, b) => {
        expect(addMod(a, b)).toBe(addMod(b, a));
      }),
      propertyOptions,
    );
  });

  test('zero is the additive identity modulo L', () => {
    fc.assert(
      fc.property(scalarArbitrary, (a) => {
        expect(addMod(a, 0n)).toBe(a);
      }),
      propertyOptions,
    );
  });

  test('scalar byte encoding round-trips valid reduced scalars', () => {
    fc.assert(
      fc.property(scalarArbitrary, (a) => {
        expect(bytesToScalar(scalarToBytes(a))).toBe(a);
      }),
      propertyOptions,
    );
  });

  test('seedToScalar is deterministic and seed-sensitive', () => {
    fc.assert(
      fc.property(seedArbitrary, seedArbitrary, (seedA, seedB) => {
        expect(seedToScalar(seedA)).toBe(seedToScalar(seedA));

        if (!Buffer.from(seedA).equals(Buffer.from(seedB))) {
          expect(seedToScalar(seedA)).not.toBe(seedToScalar(seedB));
        }
      }),
      propertyOptions,
    );
  });

  test('stealth scalar point equation holds', () => {
    fc.assert(
      fc.property(scalarArbitrary, scalarArbitrary, (m, sharedHashScalar) => {
        fc.pre(addMod(m, sharedHashScalar) !== 0n);

        const spendingPubKey = publicKeyFromScalar(m);
        const stealthPubKey = deriveStealthPubKey(spendingPubKey, sharedHashScalar);
        const expectedPubKey = publicKeyFromScalar(addMod(m, sharedHashScalar));

        expect(stealthPubKey).toEqual(expectedPubKey);
      }),
      propertyOptions,
    );
  }, 20_000);

  test('view tags are uniform enough across deterministic shared-secret samples', () => {
    const sampleSize = 10_000;
    const bucketCount = 256;
    const expected = sampleSize / bucketCount;
    const buckets = new Array<number>(bucketCount).fill(0);

    for (let i = 0; i < sampleSize; i++) {
      buckets[computeViewTag(deterministicSecret(i))] += 1;
    }

    const chiSquare = buckets.reduce(
      (sum, observed) => sum + (observed - expected) ** 2 / expected,
      0,
    );

    expect(chiSquare).toBeLessThan(330);
  });

  test('signWithScalar signatures verify against the matching public key', () => {
    fc.assert(
      fc.property(scalarArbitrary, messageArbitrary, (scalar, message) => {
        const publicKey = publicKeyFromScalar(scalar);
        const signature = signWithScalar(message, scalar, publicKey);

        expect(ed25519.verify(signature, message, publicKey)).toBe(true);
      }),
      propertyOptions,
    );
  }, 20_000);
});
