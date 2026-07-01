import { InvalidMetaAddressError } from '../../errors';

/** Parsed memo from a Stellar transaction. */
export interface StellarMemo {
  type: 'text' | 'id' | 'hash' | 'return';
  value: string;
}

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
    throw new InvalidMetaAddressError('', 'Invalid hex string length');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Extracts the memo from a Stellar transaction object (e.g. a Horizon record).
 *
 * Handles all four memo types: text, id, hash, and return. Hash and return
 * memos are returned as lowercase hex strings.
 *
 * @param transaction - Any object with `memo_type` and `memo` fields (Horizon format).
 * @returns A `{ type, value }` pair, or `null` for `MemoNone` / missing memos.
 *
 * @example
 * ```ts
 * import { extractMemo } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const memo = extractMemo(tx);
 * if (memo) {
 *   console.log(memo.type, memo.value); // e.g. "text" "invoice 1234"
 * }
 * ```
 */
export function extractMemo(transaction: {
  memo_type?: string;
  memo?: string;
}): StellarMemo | null {
  const { memo_type, memo } = transaction;

  if (!memo_type || memo_type === 'none' || !memo) return null;

  switch (memo_type) {
    case 'text':
      return { type: 'text', value: memo };
    case 'id':
      return { type: 'id', value: memo };
    case 'hash':
      return { type: 'hash', value: memoBufferToHex(memo) };
    case 'return':
      return { type: 'return', value: memoBufferToHex(memo) };
    default:
      return null;
  }
}

/** Normalise a memo value that may arrive as a base64 string or hex. */
function memoBufferToHex(value: string): string {
  // Horizon encodes hash/return memos as base64
  try {
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length > 0) return bytesToHex(bytes);
  } catch {
    // fall through
  }
  return value.toLowerCase();
}
