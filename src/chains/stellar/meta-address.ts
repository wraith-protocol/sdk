import { ed25519 } from '@noble/curves/ed25519';
import { META_ADDRESS_PREFIX } from './constants';
import type { StealthMetaAddress } from './types';
import { bytesToHex, hexToBytes } from './utils';

/**
 * Encodes a recipient's spending and viewing public keys into a shareable stealth
 * meta-address string.
 *
 * The resulting string is what a recipient publishes (e.g. in their profile or ENS
 * equivalent) so that senders can generate one-time stealth addresses for them without
 * any further interaction.
 *
 * Format: `st:xlm:<spending_pubkey_hex><viewing_pubkey_hex>` (128 hex chars after the
 * prefix, representing two 32-byte ed25519 keys).
 *
 * Use {@link decodeStealthMetaAddress} on the sender side to extract the keys back out.
 *
 * @param spendingPubKey - Recipient's 32-byte ed25519 spending public key
 *   (from {@link deriveStealthKeys}).
 * @param viewingPubKey - Recipient's 32-byte ed25519 viewing public key
 *   (from {@link deriveStealthKeys}).
 * @returns The `st:xlm:...` meta-address string.
 * @throws {Error} If either key is not 32 bytes or is not a valid ed25519 point.
 *
 * @example
 * ```ts
 * import {
 *   deriveStealthKeys,
 *   encodeStealthMetaAddress,
 * } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const { spendingPubKey, viewingPubKey } = deriveStealthKeys(signatureBytes);
 * const metaAddress = encodeStealthMetaAddress(spendingPubKey, viewingPubKey);
 * // => "st:xlm:a1b2c3...d4e5f6..."
 * ```
 *
 * @see {@link decodeStealthMetaAddress} to reverse this operation
 */
export function encodeStealthMetaAddress(
  spendingPubKey: Uint8Array,
  viewingPubKey: Uint8Array,
): string {
  if (spendingPubKey.length !== 32) {
    throw new Error(`Spending public key must be 32 bytes, got ${spendingPubKey.length}`);
  }
  if (viewingPubKey.length !== 32) {
    throw new Error(`Viewing public key must be 32 bytes, got ${viewingPubKey.length}`);
  }

  try {
    ed25519.ExtendedPoint.fromHex(spendingPubKey);
    ed25519.ExtendedPoint.fromHex(viewingPubKey);
  } catch {
    throw new Error('Invalid ed25519 public key');
  }

  return `${META_ADDRESS_PREFIX}${bytesToHex(spendingPubKey)}${bytesToHex(viewingPubKey)}`;
}

/**
 * Decodes a stealth meta-address string into its component public keys.
 *
 * Use this on the sender side, after the recipient has shared their meta-address, to
 * extract the keys needed to call {@link generateStealthAddress}.
 *
 * Validates the `st:xlm:` prefix, total length, and that both embedded keys are
 * valid ed25519 curve points before returning.
 *
 * @param metaAddress - A `st:xlm:...` string produced by {@link encodeStealthMetaAddress}.
 * @returns An object with `prefix`, `spendingPubKey`, and `viewingPubKey`.
 * @throws {Error} If the prefix is wrong, the length is incorrect, or either key is not
 *   a valid ed25519 point.
 *
 * @example
 * ```ts
 * import {
 *   decodeStealthMetaAddress,
 *   generateStealthAddress,
 * } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(recipientMetaAddress);
 * const stealth = generateStealthAddress(spendingPubKey, viewingPubKey);
 * ```
 *
 * @see {@link encodeStealthMetaAddress} to produce a meta-address
 */
export function decodeStealthMetaAddress(metaAddress: string): StealthMetaAddress {
  if (!metaAddress.startsWith(META_ADDRESS_PREFIX)) {
    throw new Error(`Invalid stealth meta-address prefix. Expected "${META_ADDRESS_PREFIX}"`);
  }

  const hex = metaAddress.slice(META_ADDRESS_PREFIX.length);

  if (hex.length !== 128) {
    throw new Error(
      `Invalid stealth meta-address length. Expected 128 hex chars after prefix, got ${hex.length}`,
    );
  }

  const spendingPubKey = hexToBytes(hex.slice(0, 64));
  const viewingPubKey = hexToBytes(hex.slice(64));

  try {
    ed25519.ExtendedPoint.fromHex(spendingPubKey);
    ed25519.ExtendedPoint.fromHex(viewingPubKey);
  } catch {
    throw new Error('Invalid ed25519 public key in meta-address');
  }

  return {
    prefix: META_ADDRESS_PREFIX,
    spendingPubKey,
    viewingPubKey,
  };
}