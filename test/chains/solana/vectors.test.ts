import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { deriveStealthKeys } from '../../../src/chains/solana/keys';
import { generateStealthAddress } from '../../../src/chains/solana/stealth';
import { checkStealthAddress } from '../../../src/chains/solana/scan';
import {
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
} from '../../../src/chains/solana/meta-address';
import { bytesToHex, hexToBytes } from '../../../src/chains/solana/utils';

const vectors = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../../packages/test-vectors/vectors/solana.json'),
    'utf8',
  ),
);

describe('solana vectors: key_derivation', () => {
  for (const v of vectors.key_derivation) {
    test(`sig ${v.input.signature.slice(0, 10)}…`, () => {
      const keys = deriveStealthKeys(hexToBytes(v.input.signature));
      expect(bytesToHex(keys.spendingKey)).toBe(v.output.spendingKey);
      expect(bytesToHex(keys.viewingKey)).toBe(v.output.viewingKey);
      expect(keys.spendingScalar.toString()).toBe(v.output.spendingScalar);
      expect(bytesToHex(keys.spendingPubKey)).toBe(v.output.spendingPubKey);
      expect(bytesToHex(keys.viewingPubKey)).toBe(v.output.viewingPubKey);
    });
  }
});

describe('solana vectors: stealth_gen', () => {
  for (const v of vectors.stealth_gen) {
    test(`ephSeed ${v.input.ephemeralSeed.slice(0, 10)}…`, () => {
      const result = generateStealthAddress(
        hexToBytes(v.input.spendingPubKey),
        hexToBytes(v.input.viewingPubKey),
        hexToBytes(v.input.ephemeralSeed),
      );
      expect(result.stealthAddress).toBe(v.output.stealthAddress);
      expect(bytesToHex(result.ephemeralPubKey)).toBe(v.output.ephemeralPubKey);
      expect(result.viewTag).toBe(v.output.viewTag);
    });
  }
});

describe('solana vectors: scan_match', () => {
  for (const v of vectors.scan_match) {
    test(`stealth ${v.input.stealthAddress.slice(0, 10)}…`, () => {
      const result = checkStealthAddress(
        hexToBytes(v.input.ephemeralPubKey),
        hexToBytes(v.input.viewingKey),
        hexToBytes(v.input.spendingPubKey),
        v.input.viewTag,
      );
      expect(result.isMatch).toBe(v.output.isMatch);
      expect(result.stealthAddress).toBe(v.input.stealthAddress);
    });
  }
});

describe('solana vectors: encoding', () => {
  for (const v of vectors.encoding) {
    test(`spendPub ${v.input.spendingPubKey.slice(0, 10)}…`, () => {
      const meta = encodeStealthMetaAddress(
        hexToBytes(v.input.spendingPubKey),
        hexToBytes(v.input.viewingPubKey),
      );
      expect(meta).toBe(v.output.metaAddress);

      const decoded = decodeStealthMetaAddress(meta);
      expect(bytesToHex(decoded.spendingPubKey)).toBe(v.output.decodedSpendingPubKey);
      expect(bytesToHex(decoded.viewingPubKey)).toBe(v.output.decodedViewingPubKey);
    });
  }
});
