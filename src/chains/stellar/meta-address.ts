import { ed25519 } from '@noble/curves/ed25519';
import { META_ADDRESS_PREFIX } from './constants';
import type { StealthMetaAddress } from './types';
import { bytesToHex, hexToBytes } from './utils';

/**
 * Encodes Stellar spending and viewing public keys into a stealth meta-address.
 *
 * Share this value with senders or name registries. It contains only public
 * keys, but it should still be treated as a stable recipient identifier.
 *
 * @param spendingPubKey - Recipient's 32-byte ed25519 spending public key.
 * @param viewingPubKey - Recipient's 32-byte ed25519 viewing public key.
 * @returns Meta-address in `st:xlm:<spending_pubkey><viewing_pubkey>` format.
 * @throws {Error} If either key is not 32 bytes or is not a valid ed25519 public key.
 *
 * @example
 * ```ts
 * import { deriveStealthKeys, encodeStealthMetaAddress } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const keys = deriveStealthKeys(signature);
 * const metaAddress = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
 * ```
 *
 * @see {@link decodeStealthMetaAddress}
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
 * Decodes a Stellar stealth meta-address into spending and viewing public keys.
 *
 * Use this on the sender side before calling {@link generateStealthAddress}.
 * The decoder validates the prefix, payload length, and ed25519 public keys.
 *
 * @param metaAddress - Stellar stealth meta-address beginning with `st:xlm:`.
 * @returns Parsed prefix, spending public key, and viewing public key.
 * @throws {Error} If the prefix, payload length, hex bytes, or ed25519 points are invalid.
 *
 * @example
 * ```ts
 * import { decodeStealthMetaAddress, generateStealthAddress } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress("st:xlm:...");
 * const payment = generateStealthAddress(spendingPubKey, viewingPubKey);
 * ```
 *
 * @see {@link encodeStealthMetaAddress}
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
