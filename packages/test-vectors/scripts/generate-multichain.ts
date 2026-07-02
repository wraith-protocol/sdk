#!/usr/bin/env tsx
/**
 * Generates test vectors for EVM, CKB, and Solana chains.
 * Uses a deterministic PRNG seeded from a fixed value so every run
 * produces the same output.
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

// Use different seed per chain for independent vectors
const rngEvm = createPrng(0x45564d20); // "EVM "
const rngCkb = createPrng(0x434b4220); // "CKB "
const rngSolana = createPrng(0x534f4c41); // "SOLA"

function rngBytes(rng: () => number, n: number): Uint8Array {
  const buf = new Uint8Array(n);
  for (let i = 0; i < n; i++) buf[i] = Math.floor(rng() * 256);
  return buf;
}

function toHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

function toHex0x(b: Uint8Array): string {
  return '0x' + toHex(b);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'vectors');
mkdirSync(OUT, { recursive: true });

const N_VECTORS = 100;
const secp256k1_n = secp256k1.CURVE.n;

// ─────────────────────────────────────────────────────────────────────────────
// EVM helpers
// ─────────────────────────────────────────────────────────────────────────────

function keccak256Bytes(data: Uint8Array): Uint8Array {
  // Manual keccak-256 using noble/hashes
  // We can't use viem here easily, so we implement it via the internal keccak
  // Actually: noble/hashes has keccak256
  // Import dynamically
  throw new Error('use keccak256 from viem');
}

// We'll use a simple import trick – inline implementation using the proper library
// Since we can use require in tsx scripts:
const { keccak256: viemKeccak256, toBytes: viemToBytes, getAddress } = await import('viem');

function keccak256Hex(hex: string): string {
  return viemKeccak256(hex as `0x${string}`);
}

function keccak256Arr(b: Uint8Array): Uint8Array {
  return viemToBytes(viemKeccak256(toHex0x(b) as `0x${string}`));
}

function evmDeriveKeys(sig65: Uint8Array) {
  const r = sig65.slice(0, 32);
  const s = sig65.slice(32, 64);
  const spendingKey = keccak256Hex(toHex0x(r)) as string;
  const viewingKey = keccak256Hex(toHex0x(s)) as string;
  const spendingPubKey = toHex0x(
    secp256k1.getPublicKey(viemToBytes(spendingKey as `0x${string}`), true),
  );
  const viewingPubKey = toHex0x(
    secp256k1.getPublicKey(viemToBytes(viewingKey as `0x${string}`), true),
  );
  return { spendingKey, viewingKey, spendingPubKey, viewingPubKey };
}

function evmGenerateStealth(
  spendingPubKeyHex: string,
  viewingPubKeyHex: string,
  ephPrivHex: string,
) {
  const ephPriv = viemToBytes(ephPrivHex as `0x${string}`);
  const ephPub = secp256k1.getPublicKey(ephPriv, true);
  const viewingPubBytes = viemToBytes(viewingPubKeyHex as `0x${string}`);
  const sharedSecret = secp256k1.getSharedSecret(ephPriv, viewingPubBytes, true);
  const hashedSecret = viemToBytes(keccak256Hex(toHex0x(sharedSecret)) as `0x${string}`);
  const viewTag = hashedSecret[0];
  const n = secp256k1_n;
  const secretScalar = BigInt(keccak256Hex(toHex0x(sharedSecret))) % n;
  const K_spend = secp256k1.ProjectivePoint.fromHex(
    viemToBytes(spendingPubKeyHex as `0x${string}`),
  );
  const sharedPoint = secp256k1.ProjectivePoint.BASE.multiply(secretScalar);
  const stealthPubKey = K_spend.add(sharedPoint);
  const uncompressed = stealthPubKey.toRawBytes(false);
  const pubKeyNoPrefix = uncompressed.slice(1);
  const addressHash = keccak256Hex(toHex0x(pubKeyNoPrefix));
  const stealthAddress = getAddress(`0x${addressHash.slice(-40)}`);
  return { stealthAddress, ephemeralPubKey: toHex0x(ephPub), viewTag };
}

function evmDerivePrivKey(
  spendingKey: string,
  ephemeralPubKey: string,
  viewingKey: string,
): string {
  const sharedSecret = secp256k1.getSharedSecret(
    viemToBytes(viewingKey as `0x${string}`),
    viemToBytes(ephemeralPubKey as `0x${string}`),
    true,
  );
  const hashedSecret = keccak256Hex(toHex0x(sharedSecret));
  const n = secp256k1_n;
  const m = BigInt(spendingKey);
  const s_h = BigInt(hashedSecret) % n;
  const stealthPrivKey = (m + s_h) % n;
  return '0x' + stealthPrivKey.toString(16).padStart(64, '0');
}

function evmEncodeMetaAddress(spendingPubKey: string, viewingPubKey: string): string {
  // EVM META_ADDRESS_PREFIX = 'st:eth:0x', then hex-without-0x appended
  const spend = spendingPubKey.startsWith('0x') ? spendingPubKey.slice(2) : spendingPubKey;
  const view = viewingPubKey.startsWith('0x') ? viewingPubKey.slice(2) : viewingPubKey;
  return `st:eth:0x${spend}${view}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CKB helpers (secp256k1 + SHA-256 + blake2b-160)
// ─────────────────────────────────────────────────────────────────────────────

// CKB uses the same key derivation as EVM
function ckbDeriveKeys(sig65: Uint8Array) {
  return evmDeriveKeys(sig65);
}

function ckbBlake160(data: Uint8Array): Uint8Array {
  const hash = blake2b(data, {
    dkLen: 32,
    personalization: new TextEncoder().encode('ckb-default-hash'),
  });
  return hash.slice(0, 20);
}

function ckbGenerateStealth(
  spendingPubKeyHex: string,
  viewingPubKeyHex: string,
  ephPrivHex: string,
) {
  const ephPriv = viemToBytes(ephPrivHex as `0x${string}`);
  const ephPub = secp256k1.getPublicKey(ephPriv, true);
  const viewingPubBytes = viemToBytes(viewingPubKeyHex as `0x${string}`);
  const sharedSecret = secp256k1.getSharedSecret(ephPriv, viewingPubBytes, true);
  const hashed = sha256(sharedSecret);
  const n = secp256k1_n;
  const secretScalar = BigInt(toHex0x(hashed)) % n;
  const K_spend = secp256k1.ProjectivePoint.fromHex(
    viemToBytes(spendingPubKeyHex as `0x${string}`),
  );
  const sharedPoint = secp256k1.ProjectivePoint.BASE.multiply(secretScalar);
  const stealthPubKeyPoint = K_spend.add(sharedPoint);
  const stealthPubKeyBytes = stealthPubKeyPoint.toRawBytes(true);
  const pubKeyHash = ckbBlake160(stealthPubKeyBytes);
  const lockArgsBytes = new Uint8Array(53);
  lockArgsBytes.set(ephPub, 0);
  lockArgsBytes.set(pubKeyHash, 33);
  return {
    stealthPubKey: toHex0x(stealthPubKeyBytes),
    stealthPubKeyHash: toHex0x(pubKeyHash),
    ephemeralPubKey: toHex0x(ephPub),
    lockArgs: toHex0x(lockArgsBytes),
  };
}

function ckbDerivePrivKey(
  spendingKey: string,
  ephemeralPubKey: string,
  viewingKey: string,
): string {
  const sharedSecret = secp256k1.getSharedSecret(
    viemToBytes(viewingKey as `0x${string}`),
    viemToBytes(ephemeralPubKey as `0x${string}`),
    true,
  );
  const hashed = sha256(sharedSecret);
  const n = secp256k1_n;
  const m = BigInt(spendingKey);
  const s_h = BigInt(toHex0x(hashed)) % n;
  const stealthPrivKey = (m + s_h) % n;
  return '0x' + stealthPrivKey.toString(16).padStart(64, '0');
}

function ckbEncodeMetaAddress(spendingPubKey: string, viewingPubKey: string): string {
  // Strip 0x prefix — CKB meta-address format: st:ckb:<66-hex><66-hex>
  const spend = spendingPubKey.startsWith('0x') ? spendingPubKey.slice(2) : spendingPubKey;
  const view = viewingPubKey.startsWith('0x') ? viewingPubKey.slice(2) : viewingPubKey;
  return `st:ckb:${spend}${view}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Solana helpers (ed25519 + X25519 + legacy view tag)
// ─────────────────────────────────────────────────────────────────────────────

// Solana reuses Stellar key derivation
const L_ed = BigInt('7237005577332262213973186563042994240857116359379907606001950938285454250989');

function bytesToScalarLE(b: Uint8Array): bigint {
  let s = 0n;
  for (let i = b.length - 1; i >= 0; i--) s = (s << 8n) | BigInt(b[i]);
  return s;
}

function seedToScalar(seed: Uint8Array): bigint {
  const h = sha512(seed);
  const a = new Uint8Array(h.slice(0, 32));
  a[0] &= 248;
  a[31] &= 127;
  a[31] |= 64;
  return bytesToScalarLE(a);
}

function hashToScalar(sharedSecret: Uint8Array): bigint {
  const prefix = new TextEncoder().encode('wraith:scalar:');
  const input = new Uint8Array(prefix.length + sharedSecret.length);
  input.set(prefix);
  input.set(sharedSecret, prefix.length);
  return bytesToScalarLE(sha256(input)) % L_ed;
}

function computeSharedSecretEd(privKey: Uint8Array, pubKey: Uint8Array): Uint8Array {
  const privX = edwardsToMontgomeryPriv(privKey);
  const pubX = edwardsToMontgomeryPub(pubKey);
  return x25519.getSharedSecret(privX, pubX);
}

// Solana uses the legacy view tag (from shared secret, not announcement tuple)
function computeLegacyViewTag(sharedSecret: Uint8Array): number {
  const prefix = new TextEncoder().encode('wraith:tag:');
  const input = new Uint8Array(prefix.length + sharedSecret.length);
  input.set(prefix);
  input.set(sharedSecret, prefix.length);
  return sha256(input)[0];
}

function deriveStealthPubKeyEd(spendPub: Uint8Array, hScalar: bigint): Uint8Array {
  const K = ed25519.ExtendedPoint.fromHex(spendPub);
  return K.add(ed25519.ExtendedPoint.BASE.multiply(hScalar)).toRawBytes();
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

// Solana address = base58 of 32-byte ed25519 pub key
// We implement a simple base58 encoder
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes: Uint8Array): string {
  let num = 0n;
  for (const b of bytes) num = (num << 8n) | BigInt(b);

  let result = '';
  while (num > 0n) {
    result = BASE58_ALPHABET[Number(num % 58n)] + result;
    num = num / 58n;
  }

  for (const b of bytes) {
    if (b !== 0) break;
    result = '1' + result;
  }

  return result;
}

function pubKeyToSolanaAddress(pubKeyBytes: Uint8Array): string {
  return base58Encode(pubKeyBytes);
}

function solanaEncodeMetaAddress(spendingPubKey: Uint8Array, viewingPubKey: Uint8Array): string {
  return `st:sol:${toHex(spendingPubKey)}${toHex(viewingPubKey)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate EVM vectors
// ─────────────────────────────────────────────────────────────────────────────

function generateEvmVectors() {
  const keyDerivation: object[] = [];
  const stealthGen: object[] = [];
  const scanMatch: object[] = [];
  const signing: object[] = [];
  const encoding: object[] = [];

  for (let i = 0; i < N_VECTORS; i++) {
    // Generate a valid 65-byte EVM signature (r||s||v)
    let sig65: Uint8Array;
    let keys: ReturnType<typeof evmDeriveKeys>;
    // Retry until we get valid scalars (extremely rare to fail)
    while (true) {
      sig65 = rngBytes(rngEvm, 65);
      // Ensure r and s result in valid secp256k1 scalars
      const r = sig65.slice(0, 32);
      const s = sig65.slice(32, 64);
      const rHash = viemToBytes(keccak256Hex(toHex0x(r)) as `0x${string}`);
      const sHash = viemToBytes(keccak256Hex(toHex0x(s)) as `0x${string}`);
      const rScalar = BigInt(toHex0x(rHash));
      const sScalar = BigInt(toHex0x(sHash));
      if (rScalar > 0n && rScalar < secp256k1_n && sScalar > 0n && sScalar < secp256k1_n) break;
    }
    keys = evmDeriveKeys(sig65);

    keyDerivation.push({
      input: { signature: toHex0x(sig65) },
      output: {
        spendingKey: keys.spendingKey,
        viewingKey: keys.viewingKey,
        spendingPubKey: keys.spendingPubKey,
        viewingPubKey: keys.viewingPubKey,
      },
    });

    // Generate ephemeral key and stealth address
    let ephPrivHex: string;
    let stealth: ReturnType<typeof evmGenerateStealth>;
    while (true) {
      const ephPrivBytes = rngBytes(rngEvm, 32);
      ephPrivHex = toHex0x(ephPrivBytes);
      // Validate as secp256k1 scalar
      const s = BigInt(ephPrivHex);
      if (s > 0n && s < secp256k1_n) break;
    }
    stealth = evmGenerateStealth(keys.spendingPubKey, keys.viewingPubKey, ephPrivHex);

    stealthGen.push({
      input: {
        spendingPubKey: keys.spendingPubKey,
        viewingPubKey: keys.viewingPubKey,
        ephemeralPrivateKey: ephPrivHex,
      },
      output: {
        stealthAddress: stealth.stealthAddress,
        ephemeralPubKey: stealth.ephemeralPubKey,
        viewTag: stealth.viewTag,
      },
    });

    scanMatch.push({
      input: {
        ephemeralPubKey: stealth.ephemeralPubKey,
        viewTag: stealth.viewTag,
        stealthAddress: stealth.stealthAddress,
        viewingKey: keys.viewingKey,
        spendingPubKey: keys.spendingPubKey,
      },
      output: { isMatch: true },
    });

    const stealthPrivKey = evmDerivePrivKey(
      keys.spendingKey,
      stealth.ephemeralPubKey,
      keys.viewingKey,
    );
    signing.push({
      input: {
        spendingKey: keys.spendingKey,
        ephemeralPubKey: stealth.ephemeralPubKey,
        viewingKey: keys.viewingKey,
      },
      output: { stealthPrivateKey: stealthPrivKey },
    });

    const metaAddress = evmEncodeMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
    encoding.push({
      input: {
        spendingPubKey: keys.spendingPubKey,
        viewingPubKey: keys.viewingPubKey,
      },
      output: {
        metaAddress,
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

// ─────────────────────────────────────────────────────────────────────────────
// Generate CKB vectors
// ─────────────────────────────────────────────────────────────────────────────

function generateCkbVectors() {
  const keyDerivation: object[] = [];
  const stealthGen: object[] = [];
  const scanMatch: object[] = [];
  const signing: object[] = [];
  const encoding: object[] = [];

  for (let i = 0; i < N_VECTORS; i++) {
    let sig65: Uint8Array;
    let keys: ReturnType<typeof ckbDeriveKeys>;
    while (true) {
      sig65 = rngBytes(rngCkb, 65);
      const r = sig65.slice(0, 32);
      const s = sig65.slice(32, 64);
      const rHash = viemToBytes(keccak256Hex(toHex0x(r)) as `0x${string}`);
      const sHash = viemToBytes(keccak256Hex(toHex0x(s)) as `0x${string}`);
      const rScalar = BigInt(toHex0x(rHash));
      const sScalar = BigInt(toHex0x(sHash));
      if (rScalar > 0n && rScalar < secp256k1_n && sScalar > 0n && sScalar < secp256k1_n) break;
    }
    keys = ckbDeriveKeys(sig65);

    keyDerivation.push({
      input: { signature: toHex0x(sig65) },
      output: {
        spendingKey: keys.spendingKey,
        viewingKey: keys.viewingKey,
        spendingPubKey: keys.spendingPubKey,
        viewingPubKey: keys.viewingPubKey,
      },
    });

    let ephPrivHex: string;
    let stealth: ReturnType<typeof ckbGenerateStealth>;
    while (true) {
      const ephPrivBytes = rngBytes(rngCkb, 32);
      ephPrivHex = toHex0x(ephPrivBytes);
      const s = BigInt(ephPrivHex);
      if (s > 0n && s < secp256k1_n) break;
    }
    stealth = ckbGenerateStealth(keys.spendingPubKey, keys.viewingPubKey, ephPrivHex);

    stealthGen.push({
      input: {
        spendingPubKey: keys.spendingPubKey,
        viewingPubKey: keys.viewingPubKey,
        ephemeralPrivateKey: ephPrivHex,
      },
      output: {
        stealthPubKey: stealth.stealthPubKey,
        stealthPubKeyHash: stealth.stealthPubKeyHash,
        ephemeralPubKey: stealth.ephemeralPubKey,
        lockArgs: stealth.lockArgs,
      },
    });

    scanMatch.push({
      input: {
        lockArgs: stealth.lockArgs,
        viewingKey: keys.viewingKey,
        spendingPubKey: keys.spendingPubKey,
      },
      output: {
        isMatch: true,
        stealthPubKeyHash: stealth.stealthPubKeyHash,
      },
    });

    const stealthPrivKey = ckbDerivePrivKey(
      keys.spendingKey,
      stealth.ephemeralPubKey,
      keys.viewingKey,
    );
    signing.push({
      input: {
        spendingKey: keys.spendingKey,
        ephemeralPubKey: stealth.ephemeralPubKey,
        viewingKey: keys.viewingKey,
      },
      output: { stealthPrivateKey: stealthPrivKey },
    });

    const metaAddress = ckbEncodeMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
    encoding.push({
      input: {
        spendingPubKey: keys.spendingPubKey,
        viewingPubKey: keys.viewingPubKey,
      },
      output: {
        metaAddress,
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

// ─────────────────────────────────────────────────────────────────────────────
// Generate Solana vectors
// ─────────────────────────────────────────────────────────────────────────────

function generateSolanaVectors() {
  const keyDerivation: object[] = [];
  const stealthGen: object[] = [];
  const scanMatch: object[] = [];
  const encoding: object[] = [];

  for (let i = 0; i < N_VECTORS; i++) {
    const sig64 = rngBytes(rngSolana, 64);
    const keys = ed25519DeriveKeys(sig64);

    keyDerivation.push({
      input: { signature: toHex(sig64) },
      output: {
        spendingKey: toHex(keys.spendingKey),
        viewingKey: toHex(keys.viewingKey),
        spendingScalar: keys.spendingScalar.toString(),
        spendingPubKey: toHex(keys.spendingPubKey),
        viewingPubKey: toHex(keys.viewingPubKey),
      },
    });

    const ephSeed = rngBytes(rngSolana, 32);
    const ephPubKey = ed25519.getPublicKey(ephSeed);
    const sharedSecret = computeSharedSecretEd(ephSeed, keys.viewingPubKey);
    const viewTag = computeLegacyViewTag(sharedSecret);
    const hScalar = hashToScalar(sharedSecret);
    const stealthPubBytes = deriveStealthPubKeyEd(keys.spendingPubKey, hScalar);
    const stealthAddress = pubKeyToSolanaAddress(stealthPubBytes);

    stealthGen.push({
      input: {
        spendingPubKey: toHex(keys.spendingPubKey),
        viewingPubKey: toHex(keys.viewingPubKey),
        ephemeralSeed: toHex(ephSeed),
      },
      output: {
        stealthAddress,
        ephemeralPubKey: toHex(ephPubKey),
        viewTag,
      },
    });

    scanMatch.push({
      input: {
        ephemeralPubKey: toHex(ephPubKey),
        viewTag,
        stealthAddress,
        viewingKey: toHex(keys.viewingKey),
        spendingPubKey: toHex(keys.spendingPubKey),
      },
      output: { isMatch: true, stealthAddress },
    });

    const metaAddress = solanaEncodeMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
    encoding.push({
      input: {
        spendingPubKey: toHex(keys.spendingPubKey),
        viewingPubKey: toHex(keys.viewingPubKey),
      },
      output: {
        metaAddress,
        decodedSpendingPubKey: toHex(keys.spendingPubKey),
        decodedViewingPubKey: toHex(keys.viewingPubKey),
      },
    });
  }

  return {
    key_derivation: keyDerivation,
    stealth_gen: stealthGen,
    scan_match: scanMatch,
    encoding,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Write output
// ─────────────────────────────────────────────────────────────────────────────

function writeVectors(chain: string, data: Record<string, object[]>) {
  const meta = {
    chain,
    version: '1.0.0',
    generated: new Date().toISOString().split('T')[0],
    count: N_VECTORS,
  };
  const out = { ...meta, ...data };
  const path = join(OUT, `${chain}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
  const total = Object.values(data).reduce((s, a) => s + a.length, 0);
  console.log(`wrote ${path} (${total} vectors across ${Object.keys(data).length} suites)`);
}

console.log('Generating EVM vectors...');
writeVectors('evm', generateEvmVectors());

console.log('Generating CKB vectors...');
writeVectors('ckb', generateCkbVectors());

console.log('Generating Solana vectors...');
writeVectors('solana', generateSolanaVectors());

console.log('Done.');
