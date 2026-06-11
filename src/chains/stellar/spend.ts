import { computeSharedSecret } from './stealth';
import { hashToScalar, signWithScalar, L } from './scalar';

/**
 * Derives the private scalar that controls a matched Stellar stealth account.
 *
 * Call this on the recipient side after an announcement has matched. The viewing
 * key detects the payment, but the spending scalar is what makes the resulting
 * stealth account spendable.
 *
 * @param spendingScalar - Recipient's private spending scalar.
 * @param viewingKey - Recipient's 32-byte viewing seed used for ECDH.
 * @param ephemeralPubKey - 32-byte ephemeral public key from the announcement.
 * @returns Stealth private scalar: `(spendingScalar + hashScalar) mod L`.
 * @throws {Error} If the ephemeral public key cannot be converted for X25519.
 *
 * @example
 * ```ts
 * import { deriveStealthPrivateScalar, hexToBytes } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const stealthScalar = deriveStealthPrivateScalar(
 *   keys.spendingScalar,
 *   keys.viewingKey,
 *   hexToBytes(announcement.ephemeralPubKey),
 * );
 * ```
 *
 * @see {@link signStellarTransaction}
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
 * Signs a Stellar transaction hash with a derived stealth private scalar.
 *
 * Use this instead of `Keypair.fromRawEd25519Seed()` because derived stealth
 * scalars are not raw ed25519 seeds. Add the returned signature to the Stellar
 * transaction envelope with the matching stealth public key.
 *
 * @param transactionHash - 32-byte SHA-256 hash of the Stellar transaction envelope.
 * @param stealthScalar - Private scalar derived for the matched stealth account.
 * @param stealthPubKey - 32-byte stealth public key that corresponds to the scalar.
 * @returns 64-byte ed25519 signature.
 * @throws This function does not validate lengths; malformed inputs may produce unusable signatures.
 *
 * @example
 * ```ts
 * import { signStellarTransaction } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const signature = signStellarTransaction(
 *   tx.hash(),
 *   match.stealthPrivateScalar,
 *   match.stealthPubKeyBytes,
 * );
 * ```
 *
 * @see {@link signWithScalar}
 */
export function signStellarTransaction(
  transactionHash: Uint8Array,
  stealthScalar: bigint,
  stealthPubKey: Uint8Array,
): Uint8Array {
  return signWithScalar(transactionHash, stealthScalar, stealthPubKey);
}
