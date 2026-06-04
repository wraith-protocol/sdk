import { ed25519 } from '@noble/curves/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { sha256 } from '@noble/hashes/sha256';

/**
 * ed25519 group order used to reduce Stellar stealth scalars.
 *
 * All derived spending scalars are reduced modulo this value before signing or
 * point multiplication.
 *
 * @see {@link hashToScalar}
 */
export const L = BigInt(
  '7237005577332262213973186563042994240857116359379907606001950938285454250989',
);

/**
 * Derives a clamped ed25519 scalar from a 32-byte seed.
 *
 * Use this when converting deterministic Wraith seeds into the scalar form used
 * by Stellar stealth derivation and signing.
 *
 * @param seed - 32-byte ed25519 seed.
 * @returns Clamped ed25519 private scalar as a bigint.
 * @throws This function does not validate length; pass a 32-byte seed.
 *
 * @example
 * ```ts
 * import { seedToScalar } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const spendingScalar = seedToScalar(spendingSeed);
 * ```
 *
 * @see {@link deriveStealthKeys}
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
 * Converts a little-endian byte array into a bigint scalar.
 *
 * This helper is exported for low-level integrations that need the same scalar
 * encoding used by the Stellar stealth primitives.
 *
 * @param bytes - Little-endian scalar bytes.
 * @returns Scalar represented as a bigint.
 * @throws This function does not throw for byte-array input.
 *
 * @example
 * ```ts
 * const scalar = bytesToScalar(new Uint8Array(32));
 * ```
 *
 * @see {@link scalarToBytes}
 */
export function bytesToScalar(bytes: Uint8Array): bigint {
  let scalar = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    scalar = (scalar << 8n) | BigInt(bytes[i]);
  }
  return scalar;
}

/**
 * Converts a bigint scalar into a 32-byte little-endian array.
 *
 * Use this when a derived scalar needs to be serialized for Stellar ed25519
 * signing internals.
 *
 * @param scalar - Scalar value to serialize.
 * @returns 32-byte little-endian scalar.
 * @throws This function does not throw; values larger than 32 bytes are truncated.
 *
 * @example
 * ```ts
 * const bytes = scalarToBytes(1n);
 * ```
 *
 * @see {@link bytesToScalar}
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
 * Derives a Stellar stealth public key from a spending key and hash scalar.
 *
 * This performs the public-key side of DKSAP: `K_spend + hashScalar * G`.
 * Senders use it while generating a one-time address; recipients use it while
 * checking whether an announcement matches.
 *
 * @param spendingPubKey - Recipient's 32-byte ed25519 spending public key.
 * @param hashScalar - Shared-secret scalar reduced modulo {@link L}.
 * @returns 32-byte compressed ed25519 public key for the stealth account.
 * @throws {Error} If `spendingPubKey` is not a valid ed25519 public key.
 *
 * @example
 * ```ts
 * import { deriveStealthPubKey, hashToScalar } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const stealthPubKey = deriveStealthPubKey(spendingPubKey, hashToScalar(sharedSecret));
 * ```
 *
 * @see {@link pubKeyToStellarAddress}
 */
export function deriveStealthPubKey(spendingPubKey: Uint8Array, hashScalar: bigint): Uint8Array {
  const K_spend = ed25519.ExtendedPoint.fromHex(spendingPubKey);
  const hashPoint = ed25519.ExtendedPoint.BASE.multiply(hashScalar);
  const stealthPoint = K_spend.add(hashPoint);
  return stealthPoint.toRawBytes();
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STELLAR_PUBLIC_KEY_VERSION = 6 << 3;

function crc16Xmodem(bytes: Uint8Array): number {
  let crc = 0x0000;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Converts a 32-byte ed25519 public key into a Stellar `G...` address.
 *
 * Use this after deriving a stealth public key to get the account string that
 * can be funded on Stellar.
 *
 * @param pubKeyBytes - 32-byte ed25519 public key.
 * @returns Stellar StrKey public account address.
 * @throws {Error} If Stellar StrKey encoding rejects the public key bytes.
 *
 * @example
 * ```ts
 * import { pubKeyToStellarAddress } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const account = pubKeyToStellarAddress(stealthPubKey);
 * ```
 *
 * @see {@link deriveStealthPubKey}
 */
export function pubKeyToStellarAddress(pubKeyBytes: Uint8Array): string {
  if (pubKeyBytes.length !== 32) {
    throw new Error(`Expected 32-byte ed25519 public key, got ${pubKeyBytes.length}`);
  }

  const payload = new Uint8Array(1 + pubKeyBytes.length + 2);
  payload[0] = STELLAR_PUBLIC_KEY_VERSION;
  payload.set(pubKeyBytes, 1);

  const checksum = crc16Xmodem(payload.subarray(0, 33));
  payload[33] = checksum & 0xff;
  payload[34] = (checksum >> 8) & 0xff;

  return base32Encode(payload);
}

/**
 * Hashes an ECDH shared secret into a Stellar stealth scalar.
 *
 * The hash is domain-separated with `wraith:scalar:` and reduced modulo
 * {@link L}. Use the result for public-key derivation and private-scalar
 * derivation.
 *
 * @param sharedSecret - 32-byte shared secret from {@link computeSharedSecret}.
 * @returns Shared-secret scalar reduced modulo {@link L}.
 * @throws This function does not throw for byte-array input.
 *
 * @example
 * ```ts
 * import { computeSharedSecret, hashToScalar } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const hashScalar = hashToScalar(computeSharedSecret(viewingKey, ephemeralPubKey));
 * ```
 *
 * @see {@link deriveStealthPubKey}
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
 * Stellar stealth private keys are derived scalars, not raw ed25519 seeds. This
 * helper implements deterministic ed25519 signing directly for those scalars.
 *
 * @param message - Message or transaction hash bytes to sign.
 * @param scalar - Raw ed25519 private scalar.
 * @param publicKey - 32-byte public key corresponding to `scalar`.
 * @returns 64-byte ed25519 signature.
 * @throws This function does not validate key correspondence; callers must pass the matching public key.
 *
 * @example
 * ```ts
 * import { signWithScalar } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const signature = signWithScalar(txHash, match.stealthPrivateScalar, match.stealthPubKeyBytes);
 * ```
 *
 * @see {@link signStellarTransaction}
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
