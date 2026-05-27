import { ed25519 } from '@noble/curves/ed25519';
import { x25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { edwardsToMontgomeryPub, edwardsToMontgomeryPriv } from '@noble/curves/ed25519';
import type { GeneratedStealthAddress } from './types';
import { hashToScalar, deriveStealthPubKey, pubKeyToStellarAddress } from './scalar';

/**
 * Generates a one-time stealth address for a recipient on Stellar (sender-side).
 *
 * Implements the Dual-Key Stealth Address Protocol (DKSAP) adapted for ed25519:
 * 1. Generate an ephemeral ed25519 keypair `(r, R)`.
 * 2. Compute ECDH shared secret via X25519: `S = X25519(r, V_recipient)`.
 * 3. Derive hash scalar: `s_h = SHA-256("wraith:scalar:" || S) mod L`.
 * 4. Derive view tag: `tag = SHA-256("wraith:tag:" || S)[0]`.
 * 5. Compute stealth public key via point addition: `P_stealth = K_spend + s_h·G`.
 * 6. Encode `P_stealth` as a Stellar G... address.
 *
 * The recipient's viewing key is sufficient to detect the payment (step 2–4 only use
 * public keys on the recipient side). The spending key is required to move funds.
 *
 * After calling this function, the sender must publish `ephemeralPubKey` and `viewTag`
 * on-chain via the announcer contract so the recipient can scan for it.
 *
 * @param spendingPubKey - Recipient's 32-byte ed25519 spending public key.
 * @param viewingPubKey - Recipient's 32-byte ed25519 viewing public key.
 * @param ephemeralSeed - Optional 32-byte seed for deterministic key generation
 *   (useful in tests). Omit in production — a random seed is generated automatically.
 * @returns A {@link GeneratedStealthAddress} containing the stealth address, ephemeral
 *   public key, and view tag.
 *
 * @example
 * ```ts
 * import {
 *   decodeStealthMetaAddress,
 *   generateStealthAddress,
 * } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(recipientMetaAddress);
 * const { stealthAddress, ephemeralPubKey, viewTag } =
 *   generateStealthAddress(spendingPubKey, viewingPubKey);
 *
 * // Send XLM to `stealthAddress`, then post ephemeralPubKey + viewTag on-chain.
 * ```
 *
 * @see {@link scanAnnouncements} for the recipient-side counterpart
 * @see {@link decodeStealthMetaAddress} to extract the recipient's public keys
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
 * Computes the X25519 shared secret between an ed25519 private key and an ed25519 public key.
 *
 * Both keys are first converted from Edwards form (ed25519) to Montgomery form (X25519)
 * before the Diffie-Hellman operation. This matches the approach used in the DKSAP
 * reference implementation.
 *
 * You rarely need to call this directly — it is used internally by
 * {@link generateStealthAddress}, {@link checkStealthAddress}, and
 * {@link deriveStealthPrivateScalar}.
 *
 * @param privateKey - 32-byte ed25519 private seed (not a scalar — the raw seed).
 * @param publicKey - 32-byte ed25519 public key.
 * @returns 32-byte X25519 shared secret.
 *
 * @example
 * ```ts
 * import { computeSharedSecret } from '@wraith-protocol/sdk/chains/stellar';
 *
 * // Verify ECDH symmetry: both sides produce the same secret
 * const secretA = computeSharedSecret(alicePrivKey, bobPubKey);
 * const secretB = computeSharedSecret(bobPrivKey, alicePubKey);
 * // secretA deepEquals secretB
 * ```
 */
export function computeSharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const privX = edwardsToMontgomeryPriv(privateKey);
  const pubX = edwardsToMontgomeryPub(publicKey);
  return x25519.getSharedSecret(privX, pubX);
}

/**
 * Derives the single-byte view tag from an X25519 shared secret.
 *
 * The view tag is `SHA-256("wraith:tag:" || sharedSecret)[0]`. Recipients compare
 * this byte against the first byte of an announcement's `metadata` field — a mismatch
 * means the announcement is not theirs (with ~255/256 probability), allowing ~99.6% of
 * announcements to be discarded before the more expensive full ECDH check.
 *
 * You rarely need to call this directly — it is called internally during
 * {@link generateStealthAddress} and {@link checkStealthAddress}.
 *
 * @param sharedSecret - 32-byte X25519 shared secret from {@link computeSharedSecret}.
 * @returns A single byte (0–255) used as a quick scan filter.
 *
 * @example
 * ```ts
 * import { computeSharedSecret, computeViewTag } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const secret = computeSharedSecret(ephemeralPrivKey, viewingPubKey);
 * const tag = computeViewTag(secret); // e.g. 117
 * ```
 */
export function computeViewTag(sharedSecret: Uint8Array): number {
  const prefix = new TextEncoder().encode('wraith:tag:');
  const input = new Uint8Array(prefix.length + sharedSecret.length);
  input.set(prefix);
  input.set(sharedSecret, prefix.length);
  return sha256(input)[0];
}