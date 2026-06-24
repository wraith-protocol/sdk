#!/usr/bin/env tsx
/**
 * Deterministic test vector generator for @wraith-protocol/test-vectors.
 *
 * Seeds a PRNG from a fixed value so every run produces the same output.
 * Produces 5 vector files per chain: key_derivation, stealth_gen, scan_match, signing, encoding.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Noble crypto ──────────────────────────────────────────────────────────────
import { secp256k1 } from '@noble/curves/secp256k1';
import {
  ed25519,
  x25519,
  edwardsToMontgomeryPub,
  edwardsToMontgomeryPriv,
} from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { blake2b } from '@noble/hashes/blake2b';
import { keccak256, toHex, toBytes, getAddress } from 'viem';
import { StrKey } from '@stellar/stellar-sdk';
import { PublicKey } from '@solana/web3.js';

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
const CKB_PERSON = new TextEncoder().encode('ckb-default-hash');
const N_VECTORS = 100;

// ── EVM helpers ───────────────────────────────────────────────────────────────
function evmDeriveKeys(sig65: Uint8Array) {
  const r = sig65.slice(0, 32);
  const s = sig65.slice(32, 64);
  const spendingKey = keccak256(toHex(r));
  const viewingKey = keccak256(toHex(s));
  const spendingPubKey = toHex(secp256k1.getPublicKey(toBytes(spendingKey), true));
  const viewingPubKey = toHex(secp256k1.getPublicKey(toBytes(viewingKey), true));
  return { spendingKey, viewingKey, spendingPubKey, viewingPubKey };
}

function evmGenStealth(spendPub: string, viewPub: string, ephPriv: Uint8Array) {
  const ephPubKey = secp256k1.getPublicKey(ephPriv, true);
  const sharedSecret = secp256k1.getSharedSecret(ephPriv, toBytes(viewPub), true);
  const hashedSecret = keccak256(toHex(sharedSecret));
  const viewTag = toBytes(hashedSecret)[0];
  const n = secp256k1.CURVE.n;
  const secretScalar = BigInt(hashedSecret) % n;
  const K_spend = secp256k1.ProjectivePoint.fromHex(toBytes(spendPub));
  const stealthPub = K_spend.add(secp256k1.ProjectivePoint.BASE.multiply(secretScalar));
  const unprefixed = stealthPub.toRawBytes(false).slice(1);
  const addrHash = keccak256(toHex(unprefixed));
  const stealthAddress = getAddress(`0x${addrHash.slice(-40)}`);
  return { stealthAddress, ephemeralPubKey: toHex(ephPubKey), viewTag };
}

function evmDerivePrivKey(spendKey: string, ephPub: string, viewKey: string): string {
  const sharedSecret = secp256k1.getSharedSecret(toBytes(viewKey), toBytes(ephPub), true);
  const hashedSecret = keccak256(toHex(sharedSecret));
  const n = secp256k1.CURVE.n;
  const m = BigInt(spendKey);
  const s_h = BigInt(hashedSecret) % n;
  const priv = (m + s_h) % n;
  return `0x${priv.toString(16).padStart(64, '0')}`;
}

// ── Ed25519 / Stellar / Solana helpers ────────────────────────────────────────
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

function computeLegacyViewTag(sharedSecret: Uint8Array): number {
  const prefix = new TextEncoder().encode('wraith:tag:');
  const input = new Uint8Array(prefix.length + sharedSecret.length);
  input.set(prefix);
  input.set(sharedSecret, prefix.length);
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

// ── CKB helpers ───────────────────────────────────────────────────────────────
function blake160(data: Uint8Array): Uint8Array {
  return blake2b(data, { personalization: CKB_PERSON, dkLen: 32 }).slice(0, 20);
}

function ckbGenStealth(spendPub: string, viewPub: string, ephPriv: Uint8Array) {
  const ephPubKey = secp256k1.getPublicKey(ephPriv, true);
  const sharedSecret = secp256k1.getSharedSecret(ephPriv, toBytes(viewPub), true);
  const hashed = sha256(sharedSecret);
  const n = secp256k1.CURVE.n;
  const secretScalar = BigInt(toHex(hashed)) % n;
  const K_spend = secp256k1.ProjectivePoint.fromHex(toBytes(spendPub));
  const stealthPubBytes = K_spend.add(
    secp256k1.ProjectivePoint.BASE.multiply(secretScalar),
  ).toRawBytes(true);
  const pubKeyHash = blake160(stealthPubBytes);
  const lockArgs = new Uint8Array(53);
  lockArgs.set(ephPubKey, 0);
  lockArgs.set(pubKeyHash, 33);
  return {
    stealthPubKey: toHex(stealthPubBytes),
    stealthPubKeyHash: toHex(pubKeyHash),
    ephemeralPubKey: toHex(ephPubKey),
    lockArgs: toHex(lockArgs),
  };
}

function ckbDerivePrivKey(spendKey: string, ephPub: string, viewKey: string): string {
  const sharedSecret = secp256k1.getSharedSecret(toBytes(viewKey), toBytes(ephPub), true);
  const hashed = sha256(sharedSecret);
  const n = secp256k1.CURVE.n;
  const m = BigInt(spendKey);
  const s_h = BigInt(toHex(hashed)) % n;
  return `0x${((m + s_h) % n).toString(16).padStart(64, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVM VECTORS
// ═══════════════════════════════════════════════════════════════════════════════

function generateEvmVectors() {
  const keyDerivation: any[] = [];
  const stealthGen: any[] = [];
  const scanMatch: any[] = [];
  const signing: any[] = [];
  const encoding: any[] = [];

  for (let i = 0; i < N_VECTORS; i++) {
    // key_derivation: derive keys from a 65-byte signature
    const sig = new Uint8Array([...randomBytes(64), 0x1b]);
    const keys = evmDeriveKeys(sig);
    keyDerivation.push({
      input: { signature: '0x' + toHexStr(sig) },
      output: {
        spendingKey: keys.spendingKey,
        viewingKey: keys.viewingKey,
        spendingPubKey: keys.spendingPubKey,
        viewingPubKey: keys.viewingPubKey,
      },
    });

    // stealth_gen: generate a stealth address
    const ephPriv = randomBytes(32);
    let validEphPriv = ephPriv;
    while (!secp256k1.utils.isValidPrivateKey(validEphPriv)) validEphPriv = randomBytes(32);
    const stealth = evmGenStealth(keys.spendingPubKey, keys.viewingPubKey, validEphPriv);
    stealthGen.push({
      input: {
        spendingPubKey: keys.spendingPubKey,
        viewingPubKey: keys.viewingPubKey,
        ephemeralPrivateKey: toHex(validEphPriv),
      },
      output: {
        stealthAddress: stealth.stealthAddress,
        ephemeralPubKey: stealth.ephemeralPubKey,
        viewTag: stealth.viewTag,
      },
    });

    // scan_match: verify scanning finds the announcement
    scanMatch.push({
      input: {
        ephemeralPubKey: stealth.ephemeralPubKey,
        viewTag: stealth.viewTag,
        stealthAddress: stealth.stealthAddress,
        viewingKey: keys.viewingKey,
        spendingPubKey: keys.spendingPubKey,
        spendingKey: keys.spendingKey,
      },
      output: {
        isMatch: true,
        stealthPrivateKey: evmDerivePrivKey(
          keys.spendingKey,
          stealth.ephemeralPubKey,
          keys.viewingKey,
        ),
      },
    });

    // signing: derive private key for stealth address
    const stealthPrivKey = evmDerivePrivKey(
      keys.spendingKey,
      stealth.ephemeralPubKey,
      keys.viewingKey,
    );
    const stealthPubKey = toHex(secp256k1.getPublicKey(toBytes(stealthPrivKey), true));
    signing.push({
      input: {
        spendingKey: keys.spendingKey,
        ephemeralPubKey: stealth.ephemeralPubKey,
        viewingKey: keys.viewingKey,
      },
      output: {
        stealthPrivateKey: stealthPrivKey,
        stealthPubKey,
      },
    });

    // encoding: encode and decode meta-address
    const meta = `st:eth:0x${keys.spendingPubKey.slice(2)}${keys.viewingPubKey.slice(2)}`;
    encoding.push({
      input: {
        spendingPubKey: keys.spendingPubKey,
        viewingPubKey: keys.viewingPubKey,
      },
      output: {
        metaAddress: meta,
        decodedSpendingPubKey: keys.spendingPubKey,
        decodedViewingPubKey: keys.viewingPubKey,
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
// SOLANA VECTORS
// ═══════════════════════════════════════════════════════════════════════════════

function generateSolanaVectors() {
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

    // stealth_gen (Solana uses legacy view tag from shared secret)
    const ephSeed = randomBytes(32);
    const ephPubKey = ed25519.getPublicKey(ephSeed);
    const sharedSecret = computeSharedSecret(ephSeed, keys.viewingPubKey);
    const viewTag = computeLegacyViewTag(sharedSecret);
    const hScalar = hashToScalar(sharedSecret);
    const stealthPubBytes = deriveStealthPubKey(keys.spendingPubKey, hScalar);
    const stealthAddress = new PublicKey(stealthPubBytes).toBase58();

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

    // signing
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
    const meta = `st:sol:${toHexStr(keys.spendingPubKey)}${toHexStr(keys.viewingPubKey)}`;
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
// CKB VECTORS
// ═══════════════════════════════════════════════════════════════════════════════

function generateCkbVectors() {
  const keyDerivation: any[] = [];
  const stealthGen: any[] = [];
  const scanMatch: any[] = [];
  const signing: any[] = [];
  const encoding: any[] = [];

  for (let i = 0; i < N_VECTORS; i++) {
    const sig = new Uint8Array([...randomBytes(64), 0x1b]);
    const keys = evmDeriveKeys(sig);

    keyDerivation.push({
      input: { signature: '0x' + toHexStr(sig) },
      output: {
        spendingKey: keys.spendingKey,
        viewingKey: keys.viewingKey,
        spendingPubKey: keys.spendingPubKey,
        viewingPubKey: keys.viewingPubKey,
      },
    });

    // stealth_gen
    let ephPriv = randomBytes(32);
    while (!secp256k1.utils.isValidPrivateKey(ephPriv)) ephPriv = randomBytes(32);
    const stealth = ckbGenStealth(keys.spendingPubKey, keys.viewingPubKey, ephPriv);
    stealthGen.push({
      input: {
        spendingPubKey: keys.spendingPubKey,
        viewingPubKey: keys.viewingPubKey,
        ephemeralPrivateKey: toHex(ephPriv),
      },
      output: stealth,
    });

    // scan_match
    const stealthPrivKey = ckbDerivePrivKey(
      keys.spendingKey,
      stealth.ephemeralPubKey,
      keys.viewingKey,
    );
    scanMatch.push({
      input: {
        lockArgs: stealth.lockArgs,
        viewingKey: keys.viewingKey,
        spendingPubKey: keys.spendingPubKey,
        spendingKey: keys.spendingKey,
      },
      output: {
        isMatch: true,
        stealthPrivateKey: stealthPrivKey,
        stealthPubKeyHash: stealth.stealthPubKeyHash,
      },
    });

    // signing: derive private key
    signing.push({
      input: {
        spendingKey: keys.spendingKey,
        ephemeralPubKey: stealth.ephemeralPubKey,
        viewingKey: keys.viewingKey,
      },
      output: {
        stealthPrivateKey: stealthPrivKey,
        stealthPubKey: stealth.stealthPubKey,
      },
    });

    // encoding
    const meta = `st:ckb:${keys.spendingPubKey.slice(2)}${keys.viewingPubKey.slice(2)}`;
    encoding.push({
      input: {
        spendingPubKey: keys.spendingPubKey,
        viewingPubKey: keys.viewingPubKey,
      },
      output: {
        metaAddress: meta,
        decodedSpendingPubKey: keys.spendingPubKey,
        decodedViewingPubKey: keys.viewingPubKey,
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

console.log('Generating EVM vectors...');
writeVectors('evm', generateEvmVectors());

console.log('Generating Stellar vectors...');
writeVectors('stellar', generateStellarVectors());

console.log('Generating Solana vectors...');
writeVectors('solana', generateSolanaVectors());

console.log('Generating CKB vectors...');
writeVectors('ckb', generateCkbVectors());

console.log('Done.');
