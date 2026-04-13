import { ed25519 } from '@noble/curves/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { sha256 } from '@noble/hashes/sha256';
import { StrKey } from '@stellar/stellar-sdk';

/**
 * ed25519 group order (order of the base point).
 * L = 2^252 + 27742317777372353535851937790883648493
 */
export const L = BigInt(
  '7237005577332262213973186563042994240857116359379907606001950938285454250989',
);

/**
 * Derives the clamped ed25519 scalar from a 32-byte seed.
 *
 * This mirrors the standard ed25519 key derivation:
 *   1. h = SHA-512(seed)
 *   2. scalar = clamp(h[0:32])
 *
 * Clamping: clear bits 0,1,2 of byte 0; clear bit 7, set bit 6 of byte 31.
 */
export function seedToScalar(seed: Uint8Array): bigint {
  const h = sha512(seed);
  const a = new Uint8Array(h.slice(0, 32));

  // Clamp
  a[0] &= 248;
  a[31] &= 127;
  a[31] |= 64;

  return bytesToScalar(a);
}

/**
 * Converts a 32-byte little-endian array to a bigint scalar.
 */
export function bytesToScalar(bytes: Uint8Array): bigint {
  let scalar = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    scalar = (scalar << 8n) | BigInt(bytes[i]);
  }
  return scalar;
}

/**
 * Converts a bigint scalar to a 32-byte little-endian Uint8Array.
 */
export function scalarToBytes(scalar: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let s = scalar;
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(s & 0xffn);
    s >>= 8n;
  }
  return bytes;
}

/**
 * Derives the stealth public key via point addition:
 *   P_stealth = K_spend + s_h * G
 *
 * where s_h is the hashed shared secret reduced mod L.
 *
 * Returns the 32-byte compressed ed25519 public key.
 */
export function deriveStealthPubKey(spendingPubKey: Uint8Array, hashScalar: bigint): Uint8Array {
  const K_spend = ed25519.ExtendedPoint.fromHex(spendingPubKey);
  const hashPoint = ed25519.ExtendedPoint.BASE.multiply(hashScalar);
  const stealthPoint = K_spend.add(hashPoint);
  return stealthPoint.toRawBytes();
}

/**
 * Converts a 32-byte ed25519 public key to a Stellar G... address.
 */
export function pubKeyToStellarAddress(pubKeyBytes: Uint8Array): string {
  // StrKey typings expect Buffer, but Uint8Array works at runtime
  return (StrKey as any).encodeEd25519PublicKey(pubKeyBytes);
}

/**
 * Hashes a shared secret to produce a scalar mod L.
 *
 * hash_scalar = SHA-256("wraith:scalar:" || shared_secret) interpreted
 * as a little-endian integer, reduced mod L.
 */
export function hashToScalar(sharedSecret: Uint8Array): bigint {
  const prefix = new TextEncoder().encode('wraith:scalar:');
  const input = new Uint8Array(prefix.length + sharedSecret.length);
  input.set(prefix);
  input.set(sharedSecret, prefix.length);

  const hash = sha256(input);
  const raw = bytesToScalar(hash);
  return raw % L;
}

/**
 * Signs a message using a raw ed25519 scalar (not a seed).
 *
 * Implements the ed25519 signature algorithm:
 *   1. Generate deterministic nonce: r = SHA-512(prefix || message) mod L
 *   2. R = r * G
 *   3. k = SHA-512(R || A || message) mod L
 *   4. S = (r + k * a) mod L
 *   5. signature = R || S  (64 bytes)
 *
 * The "prefix" for nonce generation is derived from SHA-256 of the scalar,
 * providing determinism without needing the original seed.
 */
export function signWithScalar(
  message: Uint8Array,
  scalar: bigint,
  publicKey: Uint8Array,
): Uint8Array {
  const scalarBytes = scalarToBytes(scalar);
  const prefix = sha256(scalarBytes);

  const rInput = new Uint8Array(prefix.length + message.length);
  rInput.set(prefix);
  rInput.set(message, prefix.length);
  const rHash = sha512(rInput);
  const r = bytesToScalar(rHash) % L;

  const R = ed25519.ExtendedPoint.BASE.multiply(r);
  const encodedR = R.toRawBytes();

  const kInput = new Uint8Array(encodedR.length + publicKey.length + message.length);
  kInput.set(encodedR);
  kInput.set(publicKey, encodedR.length);
  kInput.set(message, encodedR.length + publicKey.length);
  const kHash = sha512(kInput);
  const k = bytesToScalar(kHash) % L;

  const S = (r + ((k * scalar) % L)) % L;
  const encodedS = scalarToBytes(S);

  const sig = new Uint8Array(64);
  sig.set(encodedR);
  sig.set(encodedS, 32);
  return sig;
}
