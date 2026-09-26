import { ed25519 } from '@noble/curves/ed25519';
import { InvalidMetaAddressError } from '../../errors';
import { META_ADDRESS_PREFIX } from './constants';
import type { StealthMetaAddress } from './types';
import { bytesToHex, hexToBytes } from './utils';

/**
 * Encodes Stellar spending and viewing public keys into a stealth meta-address.
 *
 * Format: `st:xlm:<spending_pubkey_hex 32 bytes><viewing_pubkey_hex 32 bytes>`
 *
 * @throws {InvalidMetaAddressError} If spending or viewing key lengths are invalid.
 */
export function encodeStealthMetaAddress(
  spendingPubKey: Uint8Array,
  viewingPubKey: Uint8Array,
): string {
  if (spendingPubKey.length !== 32) {
    throw new InvalidMetaAddressError(
      '',
      `Spending public key must be 32 bytes, got ${spendingPubKey.length}`,
    );
  }
  if (viewingPubKey.length !== 32) {
    throw new InvalidMetaAddressError(
      '',
      `Viewing public key must be 32 bytes, got ${viewingPubKey.length}`,
    );
  }

  try {
    ed25519.ExtendedPoint.fromHex(spendingPubKey);
    ed25519.ExtendedPoint.fromHex(viewingPubKey);
  } catch (err: any) {
    throw new InvalidMetaAddressError('', `Invalid ed25519 public key: ${err.message}`);
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
 * Validates the prefix, length, and that both keys are valid ed25519 points.
 *
 * @throws {InvalidMetaAddressError} If meta-address is invalid.
 */
export function decodeStealthMetaAddress(metaAddress: string): StealthMetaAddress {
  if (!metaAddress.startsWith(META_ADDRESS_PREFIX)) {
    throw new InvalidMetaAddressError(
      metaAddress,
      `Invalid stealth meta-address prefix. Expected "${META_ADDRESS_PREFIX}"`,
    );
  }

  const hex = metaAddress.slice(META_ADDRESS_PREFIX.length);

  if (hex.length !== 128) {
    throw new InvalidMetaAddressError(
      metaAddress,
      `Invalid stealth meta-address length. Expected 128 hex chars after prefix, got ${hex.length}`,
    );
  }

  const spendingPubKey = hexToBytes(hex.slice(0, 64));
  const viewingPubKey = hexToBytes(hex.slice(64));

  try {
    ed25519.ExtendedPoint.fromHex(spendingPubKey);
    ed25519.ExtendedPoint.fromHex(viewingPubKey);
  } catch (err: any) {
    throw new InvalidMetaAddressError(
      metaAddress,
      `Invalid ed25519 public key in meta-address: ${err.message}`,
    );
  }

  return {
    prefix: META_ADDRESS_PREFIX,
    spendingPubKey,
    viewingPubKey,
  };
}
