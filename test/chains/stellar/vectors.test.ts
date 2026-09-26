import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { deriveStealthKeys } from '../../../src/chains/stellar/keys';
import { generateStealthAddress } from '../../../src/chains/stellar/stealth';
import { checkStealthAddress } from '../../../src/chains/stellar/scan';
import { deriveStealthPrivateScalar } from '../../../src/chains/stellar/spend';
import {
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
} from '../../../src/chains/stellar/meta-address';
import { bytesToHex, hexToBytes } from '../../../src/chains/stellar/utils';

const vectors = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../../packages/test-vectors/vectors/stellar.json'),
    'utf8',
  ),
);

describe('stellar vectors: key_derivation', () => {
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

describe('stellar vectors: stealth_gen', () => {
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

describe('stellar vectors: scan_match', () => {
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

describe('stellar vectors: signing (cross-check via scan_match)', () => {
  // Each scan_match vector includes stealthPrivateScalar; verify it matches
  // what deriveStealthPrivateScalar produces given the same spending scalar + ephemeral key + viewing key.
  for (const v of vectors.scan_match) {
    test(`stealth ${v.input.stealthAddress.slice(0, 10)}…`, () => {
      const derived = deriveStealthPrivateScalar(
        BigInt(v.input.spendingScalar),
        hexToBytes(v.input.viewingKey),
        hexToBytes(v.input.ephemeralPubKey),
      );
      expect(derived.toString()).toBe(v.output.stealthPrivateScalar);
    });
  }
});

describe('stellar vectors: encoding', () => {
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
