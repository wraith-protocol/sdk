import { blake2b } from '@noble/hashes/blake2b';
import { toHex } from 'viem';
import type { HexString } from './types';

/** CKB personalization string for blake2b hashing. */
const CKB_PERSONALIZATION = new TextEncoder().encode('ckb-default-hash');

/**
 * Computes the blake160 hash of data using CKB's personalized blake2b.
 *
 * blake160 = blake2b(data, personalization="ckb-default-hash", dkLen=32)[0:20]
 *
 * This is how CKB derives the 20-byte pubkey hash used in lock script args.
 */
export function blake160(data: Uint8Array): Uint8Array {
  const hash = blake2b(data, { personalization: CKB_PERSONALIZATION, dkLen: 32 });
  return hash.slice(0, 20);
}

/**
 * Computes blake160 and returns it as a 0x-prefixed hex string.
 */
export function blake160Hex(data: Uint8Array): HexString {
  return toHex(blake160(data));
}
