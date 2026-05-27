import { computeSharedSecret } from './stealth';
import { hashToScalar, signWithScalar, L } from './scalar';

/**
 * Derives the stealth private scalar that controls a stealth address, given the
 * recipient's spending scalar and the announcement's ephemeral public key.
 *
 * This is the standalone version of the derivation — use it when you have already
 * matched an announcement via {@link checkStealthAddress} but need the spending scalar
 * separately. If you are scanning a full announcement list, {@link scanAnnouncements}
 * returns the scalar already attached to each {@link MatchedAnnouncement}.
 *
 * The math mirrors the EVM version (`p_stealth = (m + s_h) mod n`):
 * 1. `S = ECDH(viewingKey, ephemeralPubKey)` — X25519 shared secret
 * 2. `s_h = SHA-256("wraith:scalar:" || S) mod L` — hashed scalar
 * 3. `stealth_scalar = (spendingScalar + s_h) mod L`
 *
 * **Security note:** The viewing key alone cannot derive this value — the spending
 * scalar is required.
 *
 * @param spendingScalar - Recipient's clamped ed25519 spending scalar
 *   (from {@link StealthKeys.spendingScalar}).
 * @param viewingKey - Recipient's 32-byte viewing seed, used for ECDH (from
 *   {@link StealthKeys.viewingKey}).
 * @param ephemeralPubKey - The 32-byte ephemeral public key from the announcement
 *   (from {@link Announcement.ephemeralPubKey} after hex decoding).
 * @returns The stealth private scalar as a `bigint`.
 *
 * @example
 * ```ts
 * import {
 *   deriveStealthPrivateScalar,
 *   signStellarTransaction,
 * } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const stealthScalar = deriveStealthPrivateScalar(
 *   keys.spendingScalar,
 *   keys.viewingKey,
 *   ephemeralPubKeyBytes,
 * );
 *
 * const signature = signStellarTransaction(txHash, stealthScalar, stealthPubKeyBytes);
 * ```
 *
 * @see {@link scanAnnouncements} which returns the scalar pre-computed for each match
 * @see {@link signStellarTransaction} to use the scalar to sign a transaction
 */
export function deriveStealthPrivateScalar(
  spendingScalar: bigint,
  viewingKey: Uint8Array,
  ephemeralPubKey: Uint8Array,
): bigint {
  const sharedSecret = computeSharedSecret(viewingKey, ephemeralPubKey);
  const hScalar = hashToScalar(sharedSecret);
  return (spendingScalar + hScalar) % L;
}

/**
 * Signs a Stellar transaction hash using a stealth private scalar.
 *
 * Implements the ed25519 signing algorithm directly with the derived scalar, bypassing
 * `Keypair.fromRawEd25519Seed()` — which cannot accept a non-clamped derived scalar
 * like the one produced by {@link deriveStealthPrivateScalar} or found in
 * {@link MatchedAnnouncement.stealthPrivateScalar}.
 *
 * The deterministic nonce is derived from `SHA-256(scalar_bytes)` to avoid the need
 * for the original seed while preserving signature determinism.
 *
 * @param transactionHash - The 32-byte SHA-256 hash of the Stellar transaction envelope
 *   (the payload Stellar expects to be signed).
 * @param stealthScalar - The stealth private scalar (from
 *   {@link MatchedAnnouncement.stealthPrivateScalar} or
 *   {@link deriveStealthPrivateScalar}).
 * @param stealthPubKey - The corresponding 32-byte stealth public key (from
 *   {@link MatchedAnnouncement.stealthPubKeyBytes}). Required by the ed25519 signing
 *   algorithm.
 * @returns A 64-byte ed25519 signature ready to attach to the Stellar transaction.
 *
 * @example
 * ```ts
 * import {
 *   scanAnnouncements,
 *   signStellarTransaction,
 * } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const [match] = scanAnnouncements(announcements, keys.viewingKey, keys.spendingPubKey, keys.spendingScalar);
 *
 * // txHash is SHA-256(transaction_envelope_xdr)
 * const signature = signStellarTransaction(txHash, match.stealthPrivateScalar, match.stealthPubKeyBytes);
 * ```
 *
 * @see {@link deriveStealthPrivateScalar} for the standalone scalar derivation
 * @see {@link scanAnnouncements} to find payments and obtain the scalar and public key
 */
export function signStellarTransaction(
  transactionHash: Uint8Array,
  stealthScalar: bigint,
  stealthPubKey: Uint8Array,
): Uint8Array {
  return signWithScalar(transactionHash, stealthScalar, stealthPubKey);
}