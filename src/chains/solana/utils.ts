import { InvalidMetaAddressError } from '../../errors';

export { bytesToHex, hexToBytes } from '../stellar/utils';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Encodes 32 bytes as a base58 string, the address encoding Solana uses.
 *
 * Implemented locally instead of delegating to `@solana/web3.js` so that the
 * Solana module's address derivation — and therefore the package root, which
 * re-exports the unified scanner — does not pull the optional peer dependency
 * into its module graph. `@solana/web3.js` is only loaded by
 * `fetchAnnouncements()`, which imports it dynamically on demand.
 */
export function base58Encode(bytes: Uint8Array): string {
  let num = 0n;
  for (const byte of bytes) {
    num = num * 256n + BigInt(byte);
  }

  const chars: string[] = [];
  while (num > 0n) {
    chars.unshift(BASE58_ALPHABET[Number(num % 58n)]);
    num /= 58n;
  }

  // Each leading zero byte encodes as a literal '1' rather than being dropped
  // by the bigint conversion above.
  for (const byte of bytes) {
    if (byte === 0) chars.unshift('1');
    else break;
  }

  return chars.join('');
}

/**
 * Decodes a base58 string into a 32-byte key.
 *
 * @throws {InvalidMetaAddressError} If the string contains a non-base58 character.
 */
export function base58Decode(str: string): Uint8Array {
  let result = 0n;
  for (const char of str) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx === -1) throw new InvalidMetaAddressError(str, `Invalid base58 character: ${char}`);
    result = result * 58n + BigInt(idx);
  }
  const hex = result.toString(16).padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
