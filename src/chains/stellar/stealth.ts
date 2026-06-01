import { ed25519 } from '@noble/curves/ed25519';
import { x25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { edwardsToMontgomeryPub, edwardsToMontgomeryPriv } from '@noble/curves/ed25519';
import { hashToScalar, deriveStealthPubKey, pubKeyToStellarAddress } from './scalar';
import type { GeneratedStealthAddress } from './types';

const VIEW_TAG_PREFIX = new TextEncoder().encode('wraith:stellar:view-tag:v2:');
const LEGACY_VIEW_TAG_PREFIX = new TextEncoder().encode('wraith:tag:');

/**
 * Generates a one-time stealth address for a recipient on Stellar.
 *
 * Uses proper ed25519 point addition (matching EVM's DKSAP):
 *   1. Generate ephemeral ed25519 keypair (r, R)
 *   2. ECDH: shared_secret = X25519(r, V_recipient)
 *   3. hash_scalar = SHA-256("wraith:scalar:" || shared_secret) mod L
 *   4. view_tag = SHA-256("wraith:stellar:view-tag:v2:" || R || V)[0]
 *   5. P_stealth = K_spend + hash_scalar * G   (point addition)
 *   6. stealth_address = Stellar encoding of P_stealth
 *
 * The viewing key can verify matches (step 5 uses only public keys).
 * The spending key is needed to derive the stealth private scalar.
 *
 * @param spendingPubKey  Recipient's 32-byte ed25519 spending public key.
 * @param viewingPubKey   Recipient's 32-byte ed25519 viewing public key.
 * @param ephemeralSeed   Optional 32-byte seed for deterministic testing.
 */
export function generateStealthAddress(
  spendingPubKey: Uint8Array,
  viewingPubKey: Uint8Array,
  ephemeralSeed?: Uint8Array,
): GeneratedStealthAddress {
  const ephSeed = ephemeralSeed ?? ed25519.utils.randomPrivateKey();
  const ephPubKey = ed25519.getPublicKey(ephSeed);

  const sharedSecret = computeSharedSecret(ephSeed, viewingPubKey);

  const viewTag = computeAnnouncementViewTag(ephPubKey, viewingPubKey);

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
 * Computes the X25519 shared secret between a private key and a public key.
 * Converts ed25519 keys to X25519 (Montgomery form) first.
 */
export function computeSharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const privX = edwardsToMontgomeryPriv(privateKey);
  const pubX = edwardsToMontgomeryPub(publicKey);
  return x25519.getSharedSecret(privX, pubX);
}

/**
 * Computes the view tag from the public announcement tuple.
 *
 * view_tag = SHA-256("wraith:stellar:view-tag:v2:" || R_ephemeral || V_recipient)[0]
 *
 * The tag intentionally depends only on public data already present in the
 * announcement/meta-address. Scanners can reject ~255/256 announcements with
 * one SHA-256 instead of paying for X25519 first; only candidates that pass
 * this public prefilter need the full shared-secret derivation.
 */
export function computeAnnouncementViewTag(
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

/**
 * Computes the legacy view tag from a shared secret.
 *
 * @deprecated Stellar scanning now uses computeAnnouncementViewTag() so the
 * view-tag filter runs before X25519. This function is kept for compatibility
 * checks and benchmark comparisons with the pre-batching scan path.
 */
export function computeViewTag(sharedSecret: Uint8Array): number {
  const input = new Uint8Array(LEGACY_VIEW_TAG_PREFIX.length + sharedSecret.length);
  input.set(LEGACY_VIEW_TAG_PREFIX);
  input.set(sharedSecret, LEGACY_VIEW_TAG_PREFIX.length);
  return sha256(input)[0];
}
