#!/usr/bin/env tsx
/**
 * Deterministic test vector generator for @wraith-protocol/test-vectors.
 *
 * Seeds a PRNG from a fixed value so every run produces the same output.
 * Produces 5 vector files for Stellar: key_derivation, stealth_gen, scan_match, signing, encoding.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Noble crypto ──────────────────────────────────────────────────────────────
import {
  ed25519,
  x25519,
  edwardsToMontgomeryPub,
  edwardsToMontgomeryPriv,
} from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { StrKey } from '@stellar/stellar-sdk';

// ── PRNG (xoshiro128** seeded from fixed value) ───────────────────────────────
function createPrng(seed: number) {
  let s0 = seed | 1,
    s1 = seed ^ 0xdeadbeef,
    s2 = seed * 0x9e3779b9,
    s3 = seed + 0x6c62272e;
  return function next(): number {
    const result = Math.imul(s1 * 5, 7) | 0;
    const t = s1 << 9;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = (s3 << 11) | (s3 >>> 21);
    return (result >>> 0) / 0x100000000;
  };
}

const rng = createPrng(0x57524149); // "WRAI" in ASCII

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  for (let i = 0; i < n; i++) buf[i] = Math.floor(rng() * 256);
  return buf;
}

function toHexStr(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'vectors');
mkdirSync(OUT, { recursive: true });

// ── Constants ─────────────────────────────────────────────────────────────────
const L = BigInt('7237005577332262213973186563042994240857116359379907606001950938285454250989');
const N_VECTORS = 100;

// ── Ed25519 / Stellar helpers ─────────────────────────────────────────────────
function seedToScalar(seed: Uint8Array): bigint {
  const h = sha512(seed);
  const a = new Uint8Array(h.slice(0, 32));
  a[0] &= 248;
  a[31] &= 127;
  a[31] |= 64;
  let scalar = 0n;
  for (let i = a.length - 1; i >= 0; i--) scalar = (scalar << 8n) | BigInt(a[i]);
  return scalar;
}

function bytesToScalarLE(b: Uint8Array): bigint {
  let s = 0n;
  for (let i = b.length - 1; i >= 0; i--) s = (s << 8n) | BigInt(b[i]);
  return s;
}

function scalarToBytesLE(scalar: bigint): Uint8Array {
  const b = new Uint8Array(32);
  let s = scalar;
  for (let i = 0; i < 32; i++) {
    b[i] = Number(s & 0xffn);
    s >>= 8n;
  }
  return b;
}

function hashToScalar(sharedSecret: Uint8Array): bigint {
  const prefix = new TextEncoder().encode('wraith:scalar:');
  const input = new Uint8Array(prefix.length + sharedSecret.length);
  input.set(prefix);
  input.set(sharedSecret, prefix.length);
  return bytesToScalarLE(sha256(input)) % L;
}

function deriveStealthPubKey(spendPub: Uint8Array, hScalar: bigint): Uint8Array {
  const K = ed25519.ExtendedPoint.fromHex(spendPub);
  return K.add(ed25519.ExtendedPoint.BASE.multiply(hScalar)).toRawBytes();
}

function computeSharedSecret(privKey: Uint8Array, pubKey: Uint8Array): Uint8Array {
  const privX = edwardsToMontgomeryPriv(privKey);
  const pubX = edwardsToMontgomeryPub(pubKey);
  return x25519.getSharedSecret(privX, pubX);
}

function computeAnnouncementViewTag(ephPub: Uint8Array, viewPub: Uint8Array): number {
  const prefix = new TextEncoder().encode('wraith:stellar:view-tag:v2:');
  const input = new Uint8Array(prefix.length + ephPub.length + viewPub.length);
  input.set(prefix);
  input.set(ephPub, prefix.length);
  input.set(viewPub, prefix.length + ephPub.length);
  return sha256(input)[0];
}

function ed25519DeriveKeys(sig64: Uint8Array) {
  const spendInput = new Uint8Array(new TextEncoder().encode('wraith:spending:').length + 64);
  spendInput.set(new TextEncoder().encode('wraith:spending:'));
  spendInput.set(sig64, 16);
  const viewInput = new Uint8Array(new TextEncoder().encode('wraith:viewing:').length + 64);
  viewInput.set(new TextEncoder().encode('wraith:viewing:'));
  viewInput.set(sig64, 15);
  const spendingKey = sha256(spendInput);
  const viewingKey = sha256(viewInput);
  return {
    spendingKey,
    viewingKey,
    spendingScalar: seedToScalar(spendingKey),
    viewingScalar: seedToScalar(viewingKey),
    spendingPubKey: ed25519.getPublicKey(spendingKey),
    viewingPubKey: ed25519.getPublicKey(viewingKey),
  };
}

function signWithScalar(msg: Uint8Array, scalar: bigint, pubKey: Uint8Array): Uint8Array {
  const prefix = sha256(scalarToBytesLE(scalar));
  const rInput = new Uint8Array(prefix.length + msg.length);
  rInput.set(prefix);
  rInput.set(msg, prefix.length);
  const r = bytesToScalarLE(sha512(rInput)) % L;
  const R = ed25519.ExtendedPoint.BASE.multiply(r);
  const encodedR = R.toRawBytes();
  const kInput = new Uint8Array(encodedR.length + pubKey.length + msg.length);
  kInput.set(encodedR);
  kInput.set(pubKey, encodedR.length);
  kInput.set(msg, encodedR.length + pubKey.length);
  const k = bytesToScalarLE(sha512(kInput)) % L;
  const S = (r + ((k * scalar) % L)) % L;
  const sig = new Uint8Array(64);
  sig.set(encodedR);
  sig.set(scalarToBytesLE(S), 32);
  return sig;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STELLAR VECTORS
// ═══════════════════════════════════════════════════════════════════════════════

function generateStellarVectors() {
  const keyDerivation: any[] = [];
  const stealthGen: any[] = [];
  const scanMatch: any[] = [];
  const signing: any[] = [];
  const encoding: any[] = [];

  for (let i = 0; i < N_VECTORS; i++) {
    const sig64 = randomBytes(64);
    const keys = ed25519DeriveKeys(sig64);

    keyDerivation.push({
      input: { signature: toHexStr(sig64) },
      output: {
        spendingKey: toHexStr(keys.spendingKey),
        viewingKey: toHexStr(keys.viewingKey),
        spendingScalar: keys.spendingScalar.toString(),
        spendingPubKey: toHexStr(keys.spendingPubKey),
        viewingPubKey: toHexStr(keys.viewingPubKey),
      },
    });

    // stealth_gen
    const ephSeed = randomBytes(32);
    const ephPubKey = ed25519.getPublicKey(ephSeed);
    const sharedSecret = computeSharedSecret(ephSeed, keys.viewingPubKey);
    const viewTag = computeAnnouncementViewTag(ephPubKey, keys.viewingPubKey);
    const hScalar = hashToScalar(sharedSecret);
    const stealthPubBytes = deriveStealthPubKey(keys.spendingPubKey, hScalar);
    const stealthAddress = (StrKey as any).encodeEd25519PublicKey(stealthPubBytes);

    stealthGen.push({
      input: {
        spendingPubKey: toHexStr(keys.spendingPubKey),
        viewingPubKey: toHexStr(keys.viewingPubKey),
        ephemeralSeed: toHexStr(ephSeed),
      },
      output: {
        stealthAddress,
        ephemeralPubKey: toHexStr(ephPubKey),
        viewTag,
        stealthPubKey: toHexStr(stealthPubBytes),
      },
    });

    // scan_match
    const stealthPrivScalar = (keys.spendingScalar + hScalar) % L;
    scanMatch.push({
      input: {
        ephemeralPubKey: toHexStr(ephPubKey),
        viewTag,
        stealthAddress,
        viewingKey: toHexStr(keys.viewingKey),
        spendingPubKey: toHexStr(keys.spendingPubKey),
        spendingScalar: keys.spendingScalar.toString(),
      },
      output: {
        isMatch: true,
        stealthPrivateScalar: stealthPrivScalar.toString(),
        stealthPubKey: toHexStr(stealthPubBytes),
      },
    });

    // signing: sign a 32-byte tx hash with the stealth scalar
    const txHash = randomBytes(32);
    const sig = signWithScalar(txHash, stealthPrivScalar, stealthPubBytes);
    signing.push({
      input: {
        transactionHash: toHexStr(txHash),
        stealthScalar: stealthPrivScalar.toString(),
        stealthPubKey: toHexStr(stealthPubBytes),
      },
      output: { signature: toHexStr(sig) },
    });

    // encoding
    const meta = `st:xlm:${toHexStr(keys.spendingPubKey)}${toHexStr(keys.viewingPubKey)}`;
    encoding.push({
      input: {
        spendingPubKey: toHexStr(keys.spendingPubKey),
        viewingPubKey: toHexStr(keys.viewingPubKey),
      },
      output: {
        metaAddress: meta,
        decodedSpendingPubKey: toHexStr(keys.spendingPubKey),
        decodedViewingPubKey: toHexStr(keys.viewingPubKey),
      },
    });
  }

  return {
    key_derivation: keyDerivation,
    stealth_gen: stealthGen,
    scan_match: scanMatch,
    signing,
    encoding,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

function writeVectors(chain: string, data: Record<string, any[]>) {
  const meta = {
    chain,
    version: '1.0.0',
    generated: new Date().toISOString().split('T')[0],
    seed: '0x57524149',
    count: N_VECTORS,
  };
  const out = { ...meta, ...data };
  const path = join(OUT, `${chain}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${path} (${Object.values(data).reduce((s, a) => s + a.length, 0)} vectors)`);
}

console.log('Generating Stellar vectors...');
writeVectors('stellar', generateStellarVectors());

console.log('Done.');
