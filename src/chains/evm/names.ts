import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak256, toHex, toBytes, encodePacked } from 'viem';
import type { HexString } from './types';

/**
 * Signs a name registration message with the spending private key.
 * The contract verifies this signature against the spending public key
 * embedded in the meta-address.
 *
 * @param name The human-readable name to register.
 * @param metaAddressBytes The raw 66-byte meta-address as hex (0x-prefixed, no st:eth: prefix).
 * @param spendingKey The 32-byte spending private key.
 * @returns The 65-byte signature as a hex string.
 */
export function signNameRegistration(
  name: string,
  metaAddressBytes: HexString,
  spendingKey: HexString,
): HexString {
  const digest = keccak256(encodePacked(['string', 'bytes'], [name, metaAddressBytes]));
  return signWithEthPrefix(digest, spendingKey);
}

/**
 * Signs a name registration message for relayer-sponsored registration.
 * Includes a nonce for replay protection.
 *
 * @param name The human-readable name to register.
 * @param metaAddressBytes The raw 66-byte meta-address as hex.
 * @param spendingKey The 32-byte spending private key.
 * @param nonce The current nonce from the WraithNames contract.
 * @returns The 65-byte signature as a hex string.
 */
export function signNameRegistrationOnBehalf(
  name: string,
  metaAddressBytes: HexString,
  spendingKey: HexString,
  nonce: bigint,
): HexString {
  const digest = keccak256(
    encodePacked(['string', 'bytes', 'uint256'], [name, metaAddressBytes, nonce]),
  );
  return signWithEthPrefix(digest, spendingKey);
}

/**
 * Signs a name update message with the spending private key.
 * The contract verifies the current owner's spending key.
 *
 * @param name The name to update.
 * @param newMetaAddressBytes The new 66-byte meta-address as hex.
 * @param spendingKey The current owner's spending private key.
 * @returns The 65-byte signature as a hex string.
 */
export function signNameUpdate(
  name: string,
  newMetaAddressBytes: HexString,
  spendingKey: HexString,
): HexString {
  const digest = keccak256(encodePacked(['string', 'bytes'], [name, newMetaAddressBytes]));
  return signWithEthPrefix(digest, spendingKey);
}

/**
 * Signs a name release message with the spending private key.
 *
 * @param name The name to release.
 * @param spendingKey The owner's spending private key.
 * @returns The 65-byte signature as a hex string.
 */
export function signNameRelease(name: string, spendingKey: HexString): HexString {
  const digest = keccak256(encodePacked(['string'], [name]));
  return signWithEthPrefix(digest, spendingKey);
}

/**
 * Extracts the raw meta-address bytes from a full st:eth:0x... string.
 * Returns the 0x-prefixed 66-byte hex.
 */
export function metaAddressToBytes(metaAddress: string): HexString {
  if (!metaAddress.startsWith('st:eth:0x')) {
    throw new Error('Invalid meta-address format');
  }
  return `0x${metaAddress.slice('st:eth:0x'.length)}` as HexString;
}

/**
 * Signs a digest with the Ethereum signed message prefix, using a raw private key.
 * Returns a 65-byte signature (r || s || v).
 */
function signWithEthPrefix(digest: HexString, privateKey: HexString): HexString {
  const prefixed = keccak256(
    encodePacked(['string', 'bytes32'], ['\x19Ethereum Signed Message:\n32', digest]),
  );

  const sig = secp256k1.sign(toBytes(prefixed), toBytes(privateKey).slice(0, 32));
  const r = sig.r.toString(16).padStart(64, '0');
  const s = sig.s.toString(16).padStart(64, '0');
  const v = sig.recovery === 0 ? '1b' : '1c';
  return `0x${r}${s}${v}` as HexString;
}
