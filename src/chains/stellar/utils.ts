/**
 * Converts a `Uint8Array` to a lowercase hex string without a `0x` prefix.
 *
 * Use {@link hexToBytes} for the reverse operation.
 *
 * @param bytes - The byte array to encode.
 * @returns A lowercase hex string (e.g. `"deadbeef"`).
 *
 * @example
 * ```ts
 * import { bytesToHex } from '@wraith-protocol/sdk/chains/stellar';
 *
 * bytesToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef])); // => "deadbeef"
 * ```
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Converts a hex string (with or without a `0x` prefix) to a `Uint8Array`.
 *
 * Use {@link bytesToHex} for the reverse operation.
 *
 * @param hex - A hex-encoded string, optionally prefixed with `"0x"`.
 * @returns The decoded bytes.
 * @throws {Error} If `hex` has an odd number of characters after stripping the prefix.
 *
 * @example
 * ```ts
 * import { hexToBytes } from '@wraith-protocol/sdk/chains/stellar';
 *
 * hexToBytes("deadbeef");   // => Uint8Array([0xde, 0xad, 0xbe, 0xef])
 * hexToBytes("0xdeadbeef"); // => Uint8Array([0xde, 0xad, 0xbe, 0xef])
 * ```
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