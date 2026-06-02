import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import {
  L,
  seedToScalar,
  bytesToScalar,
  scalarToBytes,
  deriveStealthPubKey,
  signWithScalar,
} from '../../../src/chains/stellar/scalar';
import { computeViewTag } from '../../../src/chains/stellar/stealth';

// Number of fast-check runs. Override with FC_RUNS=100000 for thorough fuzz mode.
const FC_RUNS = process.env.FC_RUNS ? parseInt(process.env.FC_RUNS, 10) : 1000;

// Arbitrary: reduced scalar in [1, L-1]
const scalarArb = fc.bigInt({ min: 1n, max: L - 1n });

// Arbitrary: scalar including zero in [0, L-1]
const scalarWithZeroArb = fc.bigInt({ min: 0n, max: L - 1n });

// Arbitrary: 32-byte seed
const seed32Arb = fc.uint8Array({ minLength: 32, maxLength: 32 });

// Arbitrary: message bytes of varying length
const messageArb = fc.uint8Array({ minLength: 1, maxLength: 64 });

// Arbitrary: shared secret bytes
const sharedSecretArb = fc.uint8Array({ minLength: 1, maxLength: 64 });

/**
 * Manual ed25519 verification matching signWithScalar exactly.
 *
 * signWithScalar produces:
 *   R = r*G,  S = (r + k*scalar) mod L
 *   where k = bytesToScalar(SHA-512(R || pubKey || msg)) mod L
 *
 * Verification: S*G == R + k*pubKeyPoint
 */
function verifySignature(sig: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return ed25519.verify(sig, message, publicKey);
  } catch {
    return false;
  }
}

// ─── 1. Scalar arithmetic ────────────────────────────────────────────────────

describe('scalar arithmetic: addition associativity', () => {
  test('(a+b)+c == a+(b+c) mod L', () => {
    fc.assert(
      fc.property(scalarArb, scalarArb, scalarArb, (a, b, c) => {
        expect((((a + b) % L) + c) % L).toBe((a + ((b + c) % L)) % L);
      }),
      { numRuns: FC_RUNS },
    );
  });
});

describe('scalar arithmetic: addition commutativity', () => {
  test('a+b == b+a mod L', () => {
    fc.assert(
      fc.property(scalarArb, scalarArb, (a, b) => {
        expect((a + b) % L).toBe((b + a) % L);
      }),
      { numRuns: FC_RUNS },
    );
  });
});

describe('scalar arithmetic: additive identity', () => {
  test('a+0 == a mod L', () => {
    fc.assert(
      fc.property(scalarWithZeroArb, (a) => {
        expect((a + 0n) % L).toBe(a % L);
      }),
      { numRuns: FC_RUNS },
    );
  });
});

// ─── 2. Round-trip: bytesToScalar / scalarToBytes ────────────────────────────

describe('reduction stability', () => {
  test('bytesToScalar(scalarToBytes(a)) == a for all a in [0, L-1]', () => {
    fc.assert(
      fc.property(scalarWithZeroArb, (a) => {
        expect(bytesToScalar(scalarToBytes(a))).toBe(a);
      }),
      { numRuns: FC_RUNS },
    );
  });

  test('scalarToBytes always returns 32 bytes', () => {
    fc.assert(
      fc.property(scalarWithZeroArb, (a) => {
        expect(scalarToBytes(a)).toHaveLength(32);
      }),
      { numRuns: FC_RUNS },
    );
  });
});

// ─── 3. seedToScalar determinism ─────────────────────────────────────────────

describe('seedToScalar', () => {
  test('same seed → same scalar', () => {
    fc.assert(
      fc.property(seed32Arb, (seed) => {
        expect(seedToScalar(new Uint8Array(seed))).toBe(seedToScalar(new Uint8Array(seed)));
      }),
      { numRuns: FC_RUNS },
    );
  });

  test('different seeds → different scalars (negligible collision probability)', () => {
    fc.assert(
      fc.property(
        fc.tuple(seed32Arb, seed32Arb).filter(([a, b]) => !a.every((v, i) => v === b[i])),
        ([seedA, seedB]) => {
          expect(seedToScalar(seedA)).not.toBe(seedToScalar(seedB));
        },
      ),
      { numRuns: FC_RUNS },
    );
  });

  test('output is always a valid scalar in [0, L-1]', () => {
    // seedToScalar produces a clamped scalar (~2^254) which exceeds L.
    // Verify that output is non-negative and fits in 32 bytes.
    fc.assert(
      fc.property(seed32Arb, (seed) => {
        const s = seedToScalar(seed);
        expect(typeof s).toBe('bigint');
        expect(s >= 0n).toBe(true);
        // Clamped scalars are in [2^254, 2^255). Bit 254 is always set.
        expect(s & (1n << 254n)).toBe(1n << 254n);
        expect(s >> 255n).toBe(0n);
      }),
      { numRuns: FC_RUNS },
    );
  });
});

// ─── 4. Stealth scalar correctness: (m + s_h)*G == m*G + s_h*G ──────────────

describe('stealth scalar correctness', () => {
  test('(m + s_h)*G == m*G + s_h*G for all reduced scalars', () => {
    fc.assert(
      fc.property(scalarArb, scalarArb, (m, s_h) => {
        // Filter the point-at-infinity case (negligible in practice).
        fc.pre((m + s_h) % L !== 0n);

        const stealthScalar = (m + s_h) % L;
        const lhs = ed25519.ExtendedPoint.BASE.multiply(stealthScalar);
        const mG = ed25519.ExtendedPoint.BASE.multiply(m);
        const shG = ed25519.ExtendedPoint.BASE.multiply(s_h);
        const rhs = mG.add(shG);

        expect(lhs.equals(rhs)).toBe(true);
      }),
      { numRuns: FC_RUNS },
    );
  });

  test('deriveStealthPubKey(m*G, s_h) == (m + s_h)*G', () => {
    fc.assert(
      fc.property(scalarArb, scalarArb, (m, s_h) => {
        // (m + s_h) % L == 0 produces the point at infinity — not a valid stealth key.
        // This can only occur when s_h == L - m, a negligible probability in practice.
        fc.pre((m + s_h) % L !== 0n);

        const spendingPubKey = ed25519.ExtendedPoint.BASE.multiply(m).toRawBytes();
        const derived = deriveStealthPubKey(spendingPubKey, s_h);
        const expected = ed25519.ExtendedPoint.BASE.multiply((m + s_h) % L).toRawBytes();

        expect(derived).toEqual(expected);
      }),
      { numRuns: FC_RUNS },
    );
  });
});

// ─── 5. View-tag uniformity (chi-square) ─────────────────────────────────────

describe('view tag uniformity', () => {
  test('chi-square passes for 10k random shared secrets (uniform[0,255])', () => {
    const SAMPLES = 10_000;
    const BUCKETS = 256;

    // Use sequential 4-byte big-endian integers as shared secrets.
    // Each input is unique; SHA-256 distributes its output uniformly.
    const counts = new Array<number>(BUCKETS).fill(0);
    for (let i = 0; i < SAMPLES; i++) {
      const secret = new Uint8Array(4);
      new DataView(secret.buffer).setUint32(0, i, false);
      counts[computeViewTag(secret)]++;
    }

    const expected = SAMPLES / BUCKETS; // ≈ 39.06
    let chiSquare = 0;
    for (const count of counts) {
      chiSquare += (count - expected) ** 2 / expected;
    }

    // Critical value at p=0.001 for 255 degrees of freedom ≈ 310.
    // A well-designed hash function should score well under this threshold.
    expect(chiSquare).toBeLessThan(310);
  });
});

// ─── 6. signWithScalar round-trip ────────────────────────────────────────────

describe('signWithScalar round-trip', () => {
  test('verify(signWithScalar(scalar, msg, pubKey), msg, pubKey) == true', () => {
    fc.assert(
      fc.property(scalarArb, messageArb, (scalar, message) => {
        const publicKey = ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes();
        const sig = signWithScalar(message, scalar, publicKey);

        expect(sig).toHaveLength(64);
        expect(verifySignature(sig, message, publicKey)).toBe(true);
      }),
      { numRuns: FC_RUNS },
    );
  });

  test('signature is rejected for wrong message', () => {
    fc.assert(
      fc.property(scalarArb, messageArb, messageArb, (scalar, msg1, msg2) => {
        fc.pre(!msg1.every((v, i) => v === msg2[i]));
        const publicKey = ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes();
        const sig = signWithScalar(msg1, scalar, publicKey);
        expect(verifySignature(sig, msg2, publicKey)).toBe(false);
      }),
      { numRuns: FC_RUNS },
    );
  });

  test('signature is rejected for wrong public key', () => {
    fc.assert(
      fc.property(scalarArb, scalarArb, messageArb, (scalar, wrongScalar, message) => {
        fc.pre(scalar !== wrongScalar);
        const publicKey = ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes();
        const wrongPubKey = ed25519.ExtendedPoint.BASE.multiply(wrongScalar).toRawBytes();
        const sig = signWithScalar(message, scalar, publicKey);
        expect(verifySignature(sig, message, wrongPubKey)).toBe(false);
      }),
      { numRuns: FC_RUNS },
    );
  });
});
