import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';
import { ed25519 } from '@noble/curves/ed25519';

import {
  L,
  seedToScalar,
  bytesToScalar,
  scalarToBytes,
  deriveStealthPubKey,
  signWithScalar,
} from '../../../src/chains/stellar/scalar';

import { computeViewTag } from '../../../src/chains/stellar/stealth';

const FC_RUNS = process.env.FC_RUNS ? parseInt(process.env.FC_RUNS, 10) : 1000;
const FC_SEED = process.env.FC_SEED ? parseInt(process.env.FC_SEED, 10) : undefined;
const FC_PATH = process.env.FC_PATH;

// Configure fast-check with seed if provided
const configure = () => {
  if (FC_SEED !== undefined) {
    console.log(`\n🔬 Using fixed seed: ${FC_SEED}`);
    console.log(
      `   Replay with: FC_SEED=${FC_SEED} FC_RUNS=${FC_RUNS} pnpm test test/chains/stellar/properties.test.ts\n`,
    );
    const config: Record<string, unknown> = { seed: FC_SEED };
    if (FC_PATH !== undefined) {
      config.path = FC_PATH;
    }
    return config;
  }
  return {};
};

// Custom reporter to print seed and path on failure
const reporter = (runDetails: fc.RunDetails<unknown>) => {
  if (runDetails.failed) {
    const seed = runDetails.seed;
    const path = runDetails.counterexamplePath;
    console.error(`\n❌ Property test failed`);
    console.error(`   Seed: ${seed}`);
    console.error(`   Path: ${path}`);
    const replayCmd = `FC_SEED=${seed} FC_PATH=${path} FC_RUNS=${FC_RUNS} pnpm test test/chains/stellar/properties.test.ts`;
    console.error(`   Replay with: ${replayCmd}\n`);
    throw new Error(fc.defaultReportMessage(runDetails));
  }
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function verifySignature(sig: Uint8Array, msg: Uint8Array, pub: Uint8Array) {
  try {
    return ed25519.verify(sig, msg, pub);
  } catch {
    return false;
  }
}

// valid scalar range ONLY (fixes your crash class)
const scalarArb = fc.bigInt({ min: 1n, max: L - 1n });

const scalarAnyArb = fc.bigInt({ min: 0n, max: L - 1n });

const seed32Arb = fc.uint8Array({ minLength: 32, maxLength: 32 });

const messageArb = fc.uint8Array({ minLength: 1, maxLength: 64 });

// ─────────────────────────────────────────────────────────────
// 1. Scalar algebra sanity (minimal, not redundant proofs)
// ─────────────────────────────────────────────────────────────

describe('scalar algebra sanity', () => {
  test('addition is consistent modulo L', () => {
    fc.assert(
      fc.property(scalarArb, scalarArb, (a, b) => {
        const r1 = (a + b) % L;
        const r2 = (b + a) % L;
        expect(r1).toBe(r2);
      }),
      { numRuns: FC_RUNS, ...configure(), reporter },
    );
  });

  test('identity holds: a + 0 == a', () => {
    fc.assert(
      fc.property(scalarAnyArb, (a) => {
        expect((a + 0n) % L).toBe(a % L);
      }),
      { numRuns: FC_RUNS, ...configure(), reporter },
    );
  });
});

// ─────────────────────────────────────────────────────────────
// 2. encoding roundtrip
// ─────────────────────────────────────────────────────────────

describe('scalar encoding roundtrip', () => {
  test('bytesToScalar(scalarToBytes(a)) == a (mod L-safe)', () => {
    fc.assert(
      fc.property(scalarAnyArb, (a) => {
        const normalized = a % L;
        expect(bytesToScalar(scalarToBytes(normalized)) % L).toBe(normalized);
      }),
      { numRuns: FC_RUNS, ...configure(), reporter },
    );
  });

  test('scalarToBytes always returns 32 bytes', () => {
    fc.assert(
      fc.property(scalarAnyArb, (a) => {
        expect(scalarToBytes(a)).toHaveLength(32);
      }),
      { numRuns: FC_RUNS, ...configure(), reporter },
    );
  });
});

// ─────────────────────────────────────────────────────────────
// 3. seedToScalar stability
// ─────────────────────────────────────────────────────────────

describe('seedToScalar stability', () => {
  test('deterministic output', () => {
    fc.assert(
      fc.property(seed32Arb, (seed) => {
        const a = seedToScalar(seed);
        const b = seedToScalar(seed);
        expect(a).toBe(b);
      }),
      { numRuns: FC_RUNS, ...configure(), reporter },
    );
  });

  test('outputs are bigint and bounded reasonably', () => {
    fc.assert(
      fc.property(seed32Arb, (seed) => {
        const s = seedToScalar(seed);

        expect(typeof s).toBe('bigint');

        // MUST be non-negative
        expect(s >= 0n).toBe(true);

        // sanity: still a valid scalar space
        expect(s < 2n ** 256n).toBe(true);
      }),
      { numRuns: FC_RUNS, ...configure(), reporter },
    );
  });
});

// ─────────────────────────────────────────────────────────────
// 4. elliptic curve consistency
// ─────────────────────────────────────────────────────────────

describe('stealth pubkey correctness', () => {
  test('(m + s)G == mG + sG', () => {
    fc.assert(
      fc.property(scalarArb, scalarArb, (m, s) => {
        const sum = (m + s) % L;

        const lhs =
          sum === 0n ? ed25519.ExtendedPoint.ZERO : ed25519.ExtendedPoint.BASE.multiply(sum);

        const rhs = ed25519.ExtendedPoint.BASE.multiply(m).add(
          ed25519.ExtendedPoint.BASE.multiply(s),
        );

        expect(lhs.equals(rhs)).toBe(true);
      }),
      { numRuns: FC_RUNS, ...configure(), reporter },
    );
  });

  test('deriveStealthPubKey consistency', () => {
    fc.assert(
      fc.property(scalarArb, scalarArb, (m, s) => {
        const pub = ed25519.ExtendedPoint.BASE.multiply(m).toRawBytes();
        const derived = deriveStealthPubKey(pub, s);

        const sum = (m + s) % L;

        const expectedPoint =
          sum === 0n ? ed25519.ExtendedPoint.ZERO : ed25519.ExtendedPoint.BASE.multiply(sum);

        const expected = expectedPoint.toRawBytes();

        expect(derived).toEqual(expected);
      }),
      { numRuns: FC_RUNS, ...configure(), reporter },
    );
  });
});

// ─────────────────────────────────────────────────────────────
// 5. view tag distribution (lightweight sanity only)
// ─────────────────────────────────────────────────────────────

describe('view tag distribution sanity', () => {
  test('produces bounded values [0..255]', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 32 }), (secret) => {
        const tag = computeViewTag(secret);
        expect(tag >= 0 && tag <= 255).toBe(true);
      }),
      { numRuns: FC_RUNS, ...configure(), reporter },
    );
  });
});

// ─────────────────────────────────────────────────────────────
// 6. signWithScalar correctness
// ─────────────────────────────────────────────────────────────

describe('signWithScalar correctness', () => {
  test('valid signature verifies', () => {
    fc.assert(
      fc.property(scalarArb, messageArb, (scalar, msg) => {
        const pub = ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes();

        const sig = signWithScalar(msg, scalar, pub);

        expect(sig).toHaveLength(64);
        expect(verifySignature(sig, msg, pub)).toBe(true);
      }),
      { numRuns: FC_RUNS, ...configure(), reporter },
    );
  });

  test('wrong message invalidates signature', () => {
    fc.assert(
      fc.property(scalarArb, messageArb, messageArb, (scalar, m1, m2) => {
        fc.pre(!m1.every((v, i) => v === m2[i]));

        const pub = ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes();

        const sig = signWithScalar(m1, scalar, pub);

        expect(verifySignature(sig, m2, pub)).toBe(false);
      }),
      { numRuns: FC_RUNS, ...configure(), reporter },
    );
  });

  test('wrong pubkey fails verification', () => {
    fc.assert(
      fc.property(scalarArb, scalarArb, messageArb, (s1, s2, msg) => {
        fc.pre(s1 !== s2);

        const pub1 = ed25519.ExtendedPoint.BASE.multiply(s1).toRawBytes();

        const pub2 = ed25519.ExtendedPoint.BASE.multiply(s2).toRawBytes();

        const sig = signWithScalar(msg, s1, pub1);

        expect(verifySignature(sig, msg, pub2)).toBe(false);
      }),
      { numRuns: FC_RUNS, ...configure(), reporter },
    );
  });
});

// ─────────────────────────────────────────────────────────────
// 7. proof test: demonstrates replay output on failure
// ─────────────────────────────────────────────────────────────

if (process.env.FC_PROOF_TEST === '1') {
  describe('replay output proof test', () => {
    test('deliberately fails to prove replay output is emitted', () => {
      fc.assert(
        fc.property(scalarArb, (a: bigint) => {
          // This will always fail
          expect(a).toBe(0n);
        }),
        { numRuns: 10, seed: 42, reporter },
      );
    });
  });
}
