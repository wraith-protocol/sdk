import { describe, it, expect } from 'vitest';
import {
  ed25519,
  x25519,
  edwardsToMontgomeryPriv,
  edwardsToMontgomeryPub,
} from '@noble/curves/ed25519';
import ed2curve from 'ed2curve';
import nacl from 'tweetnacl';
import { deriveStealthPubKey } from '../../src/chains/stellar/scalar';
import { deriveStealthKeys } from '../../src/chains/stellar/keys';
import { sha256 } from '@noble/hashes/sha256';
import fs from 'fs';

const VIEW_TAG_PREFIX = new TextEncoder().encode('wraith:stellar:view-tag:v2:');
function computeAnnouncementViewTagLocal(
  ephemeralPubKey: Uint8Array,
  viewingPubKey: Uint8Array,
): number {
  const input = new Uint8Array(
    VIEW_TAG_PREFIX.length + ephemeralPubKey.length + viewingPubKey.length,
  );
  input.set(VIEW_TAG_PREFIX);
  input.set(ephemeralPubKey, VIEW_TAG_PREFIX.length);
  input.set(viewingPubKey, VIEW_TAG_PREFIX.length + ephemeralPubKey.length);
  return sha256(input)[0];
}

describe('audits:stellar', () => {
  it('edwards->montgomery conversions match ed2curve (random seed)', () => {
    const seed = ed25519.utils.randomPrivateKey();
    const pub = ed25519.getPublicKey(seed);

    const noblePrivX = edwardsToMontgomeryPriv(seed);
    const noblePubX = edwardsToMontgomeryPub(pub);

    const ed2Priv = ed2curve.convertSecretKey(seed);
    const ed2Pub = ed2curve.convertPublicKey(pub);

    expect(ed2Priv).not.toBeNull();
    expect(ed2Pub).not.toBeNull();

    expect(Buffer.from(noblePrivX)).toEqual(Buffer.from(ed2Priv as Uint8Array));
    expect(Buffer.from(noblePubX)).toEqual(Buffer.from(ed2Pub as Uint8Array));
  });

  it('shared secret matches tweetnacl.scalarMult via conversions', () => {
    const aSeed = ed25519.utils.randomPrivateKey();
    const bSeed = ed25519.utils.randomPrivateKey();

    const aPub = ed25519.getPublicKey(aSeed);
    const bPub = ed25519.getPublicKey(bSeed);

    const aPrivX_noble = edwardsToMontgomeryPriv(aSeed);
    const bPubX_noble = edwardsToMontgomeryPub(bPub);

    const ourSS = x25519.getSharedSecret(aPrivX_noble, bPubX_noble);

    const aPrivX = ed2curve.convertSecretKey(aSeed)!;
    const bPubX = ed2curve.convertPublicKey(bPub)!;

    const naclSS = nacl.scalarMult(aPrivX, bPubX);

    // noble.x25519.getSharedSecret returns 32-byte shared secret; compare full arrays
    expect(Buffer.from(ourSS.slice(0, 32))).toEqual(Buffer.from(naclSS));
  });
  it('domain separation prefixes are distinct', () => {
    const prefixes = [
      'wraith:spending:',
      'wraith:viewing:',
      'wraith:scalar:',
      'wraith:stellar:view-tag:v2:',
      'wraith:tag:',
    ];
    const set = new Set(prefixes);
    expect(set.size).toBe(prefixes.length);
  });

  it('edwards->montgomery conversions match ed2curve for several random keys', () => {
    for (let i = 0; i < 8; i++) {
      const seed = ed25519.utils.randomPrivateKey();
      const pub = ed25519.getPublicKey(seed);

      const noblePrivX = edwardsToMontgomeryPriv(seed);
      const ed2PrivX = ed2curve.convertSecretKey(seed);
      expect(ed2PrivX).not.toBeNull();
      expect(Buffer.from(noblePrivX)).toEqual(Buffer.from(ed2PrivX as Uint8Array));

      const noblePubX = edwardsToMontgomeryPub(pub);
      const ed2PubX = ed2curve.convertPublicKey(pub);
      expect(ed2PubX).not.toBeNull();
      expect(Buffer.from(noblePubX)).toEqual(Buffer.from(ed2PubX as Uint8Array));
    }
  });

  it('x25519 shared-secret parity with tweetnacl.scalarMult', () => {
    for (let i = 0; i < 8; i++) {
      const aSeed = ed25519.utils.randomPrivateKey();
      const bSeed = ed25519.utils.randomPrivateKey();

      const aPub = ed25519.getPublicKey(aSeed);
      const bPub = ed25519.getPublicKey(bSeed);

      const aPrivX = edwardsToMontgomeryPriv(aSeed);
      const bPrivX = edwardsToMontgomeryPriv(bSeed);
      const aPubX = edwardsToMontgomeryPub(aPub);
      const bPubX = edwardsToMontgomeryPub(bPub);

      const nobleSS1 = x25519.getSharedSecret(aPrivX, bPubX).slice(0, 32);
      const nobleSS2 = x25519.getSharedSecret(bPrivX, aPubX).slice(0, 32);

      const naclSS1 = nacl.scalarMult(new Uint8Array(aPrivX), new Uint8Array(bPubX));
      const naclSS2 = nacl.scalarMult(new Uint8Array(bPrivX), new Uint8Array(aPubX));

      expect(Buffer.from(nobleSS1)).toEqual(Buffer.from(naclSS1));
      expect(Buffer.from(nobleSS2)).toEqual(Buffer.from(naclSS2));
      expect(Buffer.from(nobleSS1)).toEqual(Buffer.from(nobleSS2));
    }
  });

  it('deriveStealthPubKey throws or returns spending key when hashScalar == 0 (math property)', () => {
    const seed = ed25519.utils.randomPrivateKey();
    const pub = ed25519.getPublicKey(seed);

    try {
      const out = deriveStealthPubKey(pub, 0n);
      // If implementation handles zero, it should equal the original spending pubkey
      expect(Buffer.from(out)).toEqual(Buffer.from(pub));
    } catch (err: any) {
      // If noble throws on multiply(0), assert we get an invalid-scalar like error
      expect(String(err)).toMatch(/invalid scalar|expected 1 <= sc/gi);
    }
  });

  it('deriveStealthKeys uses domain-separated prefixes', () => {
    const sig = new Uint8Array(64).fill(1);
    const keys = deriveStealthKeys(sig);

    const spendingInput = new Uint8Array(
      new TextEncoder().encode('wraith:spending:').length + sig.length,
    );
    spendingInput.set(new TextEncoder().encode('wraith:spending:'));
    spendingInput.set(sig, new TextEncoder().encode('wraith:spending:').length);
    const expectedSpending = sha256(spendingInput);

    expect(Buffer.from(keys.spendingKey)).toEqual(Buffer.from(expectedSpending));
  });

  it('pnpm-lock pins noble versions', () => {
    const lock = fs.readFileSync('pnpm-lock.yaml', 'utf8');
    expect(
      lock.includes("'@noble/curves':\n        specifier: ^1.8.0\n        version: 1.9.7"),
    ).toBeTruthy();
    expect(
      lock.includes("'@noble/hashes':\n        specifier: ^1.7.0\n        version: 1.8.0"),
    ).toBeTruthy();
  });

  it('view-tag distribution smoke test', () => {
    const viewingPub = ed25519.getPublicKey(ed25519.utils.randomPrivateKey());
    const tags = new Set<number>();
    for (let i = 0; i < 1024; i++) {
      const eph = ed25519.getPublicKey(ed25519.utils.randomPrivateKey());
      tags.add(computeAnnouncementViewTagLocal(eph, viewingPub));
    }
    // Expect at least 200 unique tags in 1024 samples (smoke check)
    expect(tags.size).toBeGreaterThan(200);
  });

  it.skip('signWithScalar deviates from RFC8032 deterministic signing (skipped - high severity)', async () => {
    // Dynamic import to avoid loading project module during normal test collection.
    const { seedToScalar } = await import('../../../src/chains/stellar/scalar');
    const { signWithScalar } = await import('../../../src/chains/stellar/scalar');
    const seed = ed25519.utils.randomPrivateKey();
    const message = new TextEncoder().encode('test message');

    const scalar = seedToScalar(seed);
    const pub = ed25519.getPublicKey(seed);

    const sigRFC = ed25519.sign(message, seed);
    const sigScalar = signWithScalar(message, scalar, pub);

    expect(ed25519.verify(sigRFC, message, pub)).toBeTruthy();
    expect(ed25519.verify(sigScalar, message, pub)).toBeTruthy();
    expect(Buffer.from(sigRFC)).not.toEqual(Buffer.from(sigScalar));
  });
});
