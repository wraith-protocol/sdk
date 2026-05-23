/**
 * Converts bytes to a lowercase hex string without a `0x` prefix.
 *
 * Use this for serializing Stellar announcement metadata and public keys before
 * they are written into event payloads.
 *
 * @param bytes - Bytes to encode.
 * @returns Lowercase hex string without a prefix.
 * @throws This function does not throw for byte-array input.
 *
 * @example
 * ```ts
 * import { bytesToHex } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const hex = bytesToHex(new Uint8Array([0xab, 0xcd]));
 * ```
 *
 * @see {@link hexToBytes}
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Converts a hex string into bytes.
 *
 * Accepts either prefixed (`0x...`) or unprefixed hex. Use this when parsing
 * announcement metadata or stealth meta-address payloads.
 *
 * @param hex - Hex string with or without a `0x` prefix.
 * @returns Parsed bytes.
 * @throws {Error} If `hex` has an odd number of characters after removing `0x`.
 *
 * @example
 * ```ts
 * import { hexToBytes } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const bytes = hexToBytes("abcd");
 * ```
 *
 * @see {@link bytesToHex}
 */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error('Invalid hex string length');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
