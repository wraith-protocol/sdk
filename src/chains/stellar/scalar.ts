import { ed25519 } from '@noble/curves/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { sha256 } from '@noble/hashes/sha256';
import { StrKey } from '@stellar/stellar-sdk';

/**
 * The ed25519 group order — the number of points on the curve (`L = 2²⁵² + 27742317777372353535851937790883648493`).
 *
 * All private scalars and derived values must be reduced modulo `L` to stay within the
 * valid scalar range. Used throughout stealth scalar arithmetic.
 */
export const L = BigInt(
  '7237005577332262213973186563042994240857116359379907606001950938285454250989',
);

/**
 * Derives a clamped ed25519 private scalar from a 32-byte seed.
 *
 * Mirrors the standard ed25519 key derivation used by most ed25519 implementations:
 * 1. `h = SHA-512(seed)` — 64-byte hash
 * 2. Take the first 32 bytes of `h`
 * 3. Clamp: clear bits 0, 1, 2 of byte 0; clear bit 7 and set bit 6 of byte 31
 * 4. Interpret as a little-endian integer → scalar
 *
 * Clamping ensures the scalar is a valid cofactor-cleared value, preventing small
 * subgroup attacks.
 *
 * @param seed - 32-byte input seed (e.g. `spendingKey` or `viewingKey` from
 *   {@link deriveStealthKeys}).
 * @returns The clamped ed25519 scalar as a `bigint`.
 *
 * @example
 * ```ts
 * import { seedToScalar } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const scalar = seedToScalar(spendingSeed);
 * ```
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
 * Converts a 32-byte little-endian byte array to a `bigint` scalar.
 *
 * The inverse operation is {@link scalarToBytes}.
 *
 * @param bytes - 32-byte little-endian representation of the scalar.
 * @returns The scalar as a `bigint`.
 */
export function bytesToScalar(bytes: Uint8Array): bigint {
  let scalar = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    scalar = (scalar << 8n) | BigInt(bytes[i]);
  }
  return scalar;
}

/**
 * Encodes a `bigint` scalar as a 32-byte little-endian `Uint8Array`.
 *
 * The inverse operation is {@link bytesToScalar}.
 *
 * @param scalar - The scalar to encode.
 * @returns A 32-byte little-endian representation.
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
 * Derives the stealth public key via ed25519 point addition.
 *
 * Computes `P_stealth = K_spend + s_h·G`, where `s_h` is the hash scalar derived from
 * the ECDH shared secret. This is the core operation in DKSAP that allows the sender to
 * compute the stealth address from public information only.
 *
 * @param spendingPubKey - Recipient's 32-byte compressed ed25519 spending public key.
 * @param hashScalar - The hashed shared secret scalar `s_h` (from {@link hashToScalar}).
 * @returns The 32-byte compressed ed25519 stealth public key.
 *
 * @example
 * ```ts
 * import { deriveStealthPubKey, hashToScalar } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const hScalar = hashToScalar(sharedSecret);
 * const stealthPubKey = deriveStealthPubKey(spendingPubKey, hScalar);
 * ```
 */
export function deriveStealthPubKey(spendingPubKey: Uint8Array, hashScalar: bigint): Uint8Array {
  const K_spend = ed25519.ExtendedPoint.fromHex(spendingPubKey);
  const hashPoint = ed25519.ExtendedPoint.BASE.multiply(hashScalar);
  const stealthPoint = K_spend.add(hashPoint);
  return stealthPoint.toRawBytes();
}

/**
 * Encodes a 32-byte ed25519 public key as a Stellar Strkey (G... address).
 *
 * @param pubKeyBytes - 32-byte compressed ed25519 public key.
 * @returns A Stellar account ID string beginning with `G`.
 *
 * @example
 * ```ts
 * import { pubKeyToStellarAddress } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const address = pubKeyToStellarAddress(stealthPubKeyBytes);
 * // => "GABC...XYZ"
 * ```
 */
export function pubKeyToStellarAddress(pubKeyBytes: Uint8Array): string {
  // StrKey typings expect Buffer, but Uint8Array works at runtime
  return (StrKey as any).encodeEd25519PublicKey(pubKeyBytes);
}

/**
 * Hashes an X25519 shared secret into a scalar suitable for ed25519 point arithmetic.
 *
 * Computes `SHA-256("wraith:scalar:" || sharedSecret)`, interprets the result as a
 * little-endian integer, and reduces it modulo {@link L}.
 *
 * The domain prefix `"wraith:scalar:"` separates this hash from the view tag hash
 * (`"wraith:tag:"`), ensuring the two derived values are cryptographically independent
 * even though they share the same shared secret input.
 *
 * @param sharedSecret - 32-byte X25519 shared secret from {@link computeSharedSecret}.
 * @returns The hash scalar `s_h` as a `bigint` in `[0, L)`.
 *
 * @example
 * ```ts
 * import { hashToScalar } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const hScalar = hashToScalar(sharedSecret);
 * // Use in point addition: P_stealth = K_spend + hScalar * G
 * ```
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
 * Signs a message with a raw ed25519 scalar instead of a seed.
 *
 * Standard ed25519 libraries derive the private scalar from a seed using SHA-512. This
 * function accepts the scalar directly, which is necessary for stealth address signing
 * where the scalar is derived via `(spendingScalar + hashScalar) mod L` rather than
 * from a seed.
 *
 * The signing algorithm:
 * 1. Derive deterministic nonce: `r = SHA-512(SHA-256(scalar_bytes) || message) mod L`
 * 2. `R = r·G`
 * 3. `k = SHA-512(R || A || message) mod L`
 * 4. `S = (r + k·scalar) mod L`
 * 5. Return `R || S` (64 bytes)
 *
 * You rarely need to call this directly — use {@link signStellarTransaction} instead.
 *
 * @param message - The message bytes to sign (for Stellar, the 32-byte transaction hash).
 * @param scalar - The private scalar (e.g. `stealthPrivateScalar` from a
 *   {@link MatchedAnnouncement}).
 * @param publicKey - The 32-byte ed25519 public key corresponding to `scalar`. Required
 *   by the signing algorithm for the `k` computation.
 * @returns A 64-byte ed25519 signature.
 *
 * @example
 * ```ts
 * import { signWithScalar } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const sig = signWithScalar(txHashBytes, stealthScalar, stealthPubKeyBytes);
 * ```
 *
 * @see {@link signStellarTransaction} for the higher-level signing API
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