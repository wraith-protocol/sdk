import { ed25519 } from '@noble/curves/ed25519';
import { x25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { edwardsToMontgomeryPub, edwardsToMontgomeryPriv } from '@noble/curves/ed25519';
import type { GeneratedStealthAddress } from './types';
import { hashToScalar, deriveStealthPubKey, pubKeyToStellarAddress } from './scalar';

/**
 * Generates a one-time stealth address for a recipient on Stellar.
 *
 * Uses proper ed25519 point addition (matching EVM's DKSAP):
 *   1. Generate ephemeral ed25519 keypair (r, R)
 *   2. ECDH: shared_secret = X25519(r, V_recipient)
 *   3. hash_scalar = SHA-256("wraith:scalar:" || shared_secret) mod L
 *   4. view_tag = SHA-256("wraith:tag:" || shared_secret)[0]
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
 * Computes the X25519 shared secret between a private key and a public key.
 * Converts ed25519 keys to X25519 (Montgomery form) first.
 */
export function computeSharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const privX = edwardsToMontgomeryPriv(privateKey);
  const pubX = edwardsToMontgomeryPub(publicKey);
  return x25519.getSharedSecret(privX, pubX);
}

/**
 * Computes the view tag from a shared secret.
 * view_tag = SHA-256("wraith:tag:" || shared_secret)[0]
 */
export function computeViewTag(sharedSecret: Uint8Array): number {
  const prefix = new TextEncoder().encode('wraith:tag:');
  const input = new Uint8Array(prefix.length + sharedSecret.length);
  input.set(prefix);
  input.set(sharedSecret, prefix.length);
  return sha256(input)[0];
}
