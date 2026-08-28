import { bench, describe } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { computeSharedSecret } from '../../../../src/chains/stellar/stealth';
import { hashToScalar, deriveStealthPubKey } from '../../../../src/chains/stellar/scalar';

const viewingKey = new Uint8Array(32).fill(0xaa);
const viewingPubKey = ed25519.getPublicKey(viewingKey);

const ephemeralKey = new Uint8Array(32).fill(0xbb);
const ephemeralPubKey = ed25519.getPublicKey(ephemeralKey);

const spendingPubKey = ed25519.getPublicKey(new Uint8Array(32).fill(0xcc));

const sharedSecret = computeSharedSecret(viewingKey, ephemeralPubKey);
const hashScalar = hashToScalar(sharedSecret);

const BENCH_OPTIONS = {
  time: 1,
  iterations: 1,
  warmupTime: 0,
  warmupIterations: 0,
};

describe('Stellar crypto hot paths', () => {
  bench(
    'public view-tag SHA-256',
    () => {
      const input = new Uint8Array(
        ephemeralPubKey.length + viewingPubKey.length,
      );

      input.set(ephemeralPubKey);
      input.set(viewingPubKey, ephemeralPubKey.length);

      sha256(input);
    },
    BENCH_OPTIONS,
  );

  bench(
    'X25519 shared secret',
    () => {
      computeSharedSecret(viewingKey, ephemeralPubKey);
    },
    BENCH_OPTIONS,
  );

  bench(
    'hash shared secret to scalar',
    () => {
      hashToScalar(sharedSecret);
    },
    BENCH_OPTIONS,
  );

  bench(
    'Ed25519 BASE.multiply(hashScalar)',
    () => {
      ed25519.ExtendedPoint.BASE.multiply(hashScalar);
    },
    BENCH_OPTIONS,
  );

  bench(
    'full stealth public-key derivation',
    () => {
      deriveStealthPubKey(spendingPubKey, hashScalar);
    },
    BENCH_OPTIONS,
  );
});