import { secp256k1 } from '@noble/curves/secp256k1';
import { toBytes } from 'viem';
import { InvalidMetaAddressError } from '../../errors';
import { META_ADDRESS_PREFIX } from './constants';
import type { HexString, StealthMetaAddress } from './types';

/**
 * Encodes spending and viewing public keys into a stealth meta-address string.
 *
 * Format: `st:eth:0x<spendingPubKey 33 bytes><viewingPubKey 33 bytes>`
 *
 * @throws {InvalidMetaAddressError} If spending or viewing key lengths are invalid.
 */
export function encodeStealthMetaAddress(
  spendingPubKey: HexString,
  viewingPubKey: HexString,
): string {
  const spendBytes = toBytes(spendingPubKey);
  const viewBytes = toBytes(viewingPubKey);

  if (spendBytes.length !== 33) {
    throw new InvalidMetaAddressError(
      '',
      `Spending public key must be 33 bytes (compressed), got ${spendBytes.length}`,
    );
  }
  if (viewBytes.length !== 33) {
    throw new InvalidMetaAddressError(
      '',
      `Viewing public key must be 33 bytes (compressed), got ${viewBytes.length}`,
    );
  }

  try {
    secp256k1.ProjectivePoint.fromHex(spendBytes);
    secp256k1.ProjectivePoint.fromHex(viewBytes);
  } catch (err: any) {
    throw new InvalidMetaAddressError('', `Invalid public key points: ${err.message}`);
  }

  const spendHex = spendingPubKey.slice(2);
  const viewHex = viewingPubKey.slice(2);

  return `${META_ADDRESS_PREFIX}${spendHex}${viewHex}`;
}

/**
 * Decodes a stealth meta-address string into its component public keys.
 *
 * Validates the prefix, length, and that both keys are valid secp256k1 points.
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

  if (hex.length !== 132) {
    throw new InvalidMetaAddressError(
      metaAddress,
      `Invalid stealth meta-address length. Expected 132 hex chars after prefix, got ${hex.length}`,
    );
  }

  const spendingPubKey = `0x${hex.slice(0, 66)}` as HexString;
  const viewingPubKey = `0x${hex.slice(66)}` as HexString;

  try {
    secp256k1.ProjectivePoint.fromHex(toBytes(spendingPubKey));
    secp256k1.ProjectivePoint.fromHex(toBytes(viewingPubKey));
  } catch (err: any) {
    throw new InvalidMetaAddressError(
      metaAddress,
      `Invalid public key points inside meta-address: ${err.message}`,
    );
  }

  return {
    prefix: META_ADDRESS_PREFIX,
    spendingPubKey,
    viewingPubKey,
  };
}
