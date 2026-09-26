import { PublicKey } from '@solana/web3.js';
import { describe, expect, test } from 'vitest';
import { pubKeyToSolanaAddress } from '../../../src/chains/solana/scalar';

// `pubKeyToSolanaAddress` encodes with the in-tree base58 helper rather than
// `@solana/web3.js`, so the optional peer stays out of the module graph. These
// cases pin the helper to the encoding the peer produces.
describe('pubKeyToSolanaAddress', () => {
  const fixtures: [name: string, bytes: Uint8Array][] = [
    ['all zero bytes', new Uint8Array(32)],
    ['single trailing byte', Uint8Array.from([...new Uint8Array(31), 1])],
    ['ascending bytes', Uint8Array.from({ length: 32 }, (_, i) => i + 1)],
    ['descending bytes', Uint8Array.from({ length: 32 }, (_, i) => 32 - i)],
    ['255s', new Uint8Array(32).fill(0xff)],
    ['leading zero then 255s', Uint8Array.from([0, 0, ...new Uint8Array(30).fill(0xff)])],
  ];

  for (const [name, bytes] of fixtures) {
    test(`matches the @solana/web3.js encoding for ${name}`, () => {
      expect(pubKeyToSolanaAddress(bytes)).toBe(new PublicKey(bytes).toBase58());
    });
  }

  test('an all-zero key is thirty-two leading "1" characters', () => {
    expect(pubKeyToSolanaAddress(new Uint8Array(32))).toBe('1'.repeat(32));
  });
});
