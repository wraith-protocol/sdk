import { ed25519 } from '@noble/curves/ed25519';
import { x25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { edwardsToMontgomeryPub, edwardsToMontgomeryPriv } from '@noble/curves/ed25519';
import type { GeneratedStealthAddress } from './types';
import { hashToScalar, deriveStealthPubKey, pubKeyToStellarAddress } from './scalar';

/**
 * Generates a one-time Stellar stealth address for a recipient.
 *
 * Call this on the sender side after decoding a recipient's Stellar
 * meta-address. The generated address is a normal `G...` Stellar account that
 * should be funded with `createAccount` before the announcement is published.
 *
 * @param spendingPubKey - Recipient's 32-byte ed25519 spending public key.
 * @param viewingPubKey - Recipient's 32-byte ed25519 viewing public key.
 * @param ephemeralSeed - Optional 32-byte seed for deterministic tests.
 * @returns Stealth account address, ephemeral public key, and 1-byte view tag.
 * @throws {Error} If a public key cannot be decoded as an ed25519 point.
 *
 * @example
 * ```ts
 * import { decodeStealthMetaAddress, generateStealthAddress } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(metaAddress);
 * const { stealthAddress, ephemeralPubKey, viewTag } = generateStealthAddress(
 *   spendingPubKey,
 *   viewingPubKey,
 * );
 * ```
 *
 * @see {@link scanAnnouncements} to detect announcements for generated addresses.
 */
export function generateStealthAddress(
  spendingPubKey: Uint8Array,
  viewingPubKey: Uint8Array,
  ephemeralSeed?: Uint8Array,
): GeneratedStealthAddress {
  const ephSeed = ephemeralSeed ?? ed25519.utils.randomPrivateKey();
  const ephPubKey = ed25519.getPublicKey(ephSeed);

  const sharedSecret = computeSharedSecret(ephSeed, viewingPubKey);

  const viewTag = computeViewTag(sharedSecret);

  const hScalar = hashToScalar(sharedSecret);

  const stealthPubKeyBytes = deriveStealthPubKey(spendingPubKey, hScalar);

  const stealthAddress = pubKeyToStellarAddress(stealthPubKeyBytes);

  return {
    stealthAddress,
    ephemeralPubKey: ephPubKey,
    viewTag,
  };
}

/**
 * Computes the X25519 shared secret for Stellar stealth address derivation.
 *
 * The helper converts ed25519 keys to Montgomery form before ECDH. Senders use
 * an ephemeral seed with the recipient viewing public key; recipients use their
 * viewing key with the sender's ephemeral public key.
 *
 * @param privateKey - 32-byte ed25519 seed used for the local side of ECDH.
 * @param publicKey - 32-byte ed25519 public key from the remote side.
 * @returns 32-byte shared secret.
 * @throws {Error} If the public key cannot be converted to Montgomery form.
 *
 * @example
 * ```ts
 * import { computeSharedSecret } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const sharedSecret = computeSharedSecret(ephemeralSeed, viewingPubKey);
 * ```
 *
 * @see {@link hashToScalar}
 */
export function computeSharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const privX = edwardsToMontgomeryPriv(privateKey);
  const pubX = edwardsToMontgomeryPub(publicKey);
  return x25519.getSharedSecret(privX, pubX);
}

/**
 * Computes the one-byte view tag for a Stellar stealth announcement.
 *
 * View tags let scanners reject most unrelated announcements before doing a
 * full stealth public-key derivation.
 *
 * @param sharedSecret - 32-byte ECDH shared secret from {@link computeSharedSecret}.
 * @returns Integer view tag in the range 0-255.
 * @throws This function does not throw for byte-array input.
 *
 * @example
 * ```ts
 * import { computeSharedSecret, computeViewTag } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const tag = computeViewTag(computeSharedSecret(ephemeralSeed, viewingPubKey));
 * ```
 *
 * @see {@link checkStealthAddress}
 */
export function computeViewTag(sharedSecret: Uint8Array): number {
  const prefix = new TextEncoder().encode('wraith:tag:');
  const input = new Uint8Array(prefix.length + sharedSecret.length);
  input.set(prefix);
  input.set(sharedSecret, prefix.length);
  return sha256(input)[0];
}
