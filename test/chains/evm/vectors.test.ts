import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { deriveStealthKeys } from '../../../src/chains/evm/keys';
import { generateStealthAddress } from '../../../src/chains/evm/stealth';
import { checkStealthAddress } from '../../../src/chains/evm/scan';
import { deriveStealthPrivateKey } from '../../../src/chains/evm/spend';
import {
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
} from '../../../src/chains/evm/meta-address';
import type { HexString } from '../../../src/chains/evm/types';

const vectors = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../../packages/test-vectors/vectors/evm.json'),
    'utf8',
  ),
);

describe('evm vectors: key_derivation', () => {
  for (const v of vectors.key_derivation) {
    test(`sig ${v.input.signature.slice(0, 10)}…`, () => {
      const keys = deriveStealthKeys(v.input.signature as HexString);
      expect(keys.spendingKey).toBe(v.output.spendingKey);
      expect(keys.viewingKey).toBe(v.output.viewingKey);
      expect(keys.spendingPubKey).toBe(v.output.spendingPubKey);
      expect(keys.viewingPubKey).toBe(v.output.viewingPubKey);
    });
  }
});

describe('evm vectors: stealth_gen', () => {
  for (const v of vectors.stealth_gen) {
    test(`ephKey ${v.input.ephemeralPrivateKey.slice(0, 10)}…`, () => {
      const result = generateStealthAddress(
        v.input.spendingPubKey as HexString,
        v.input.viewingPubKey as HexString,
        v.input.ephemeralPrivateKey as HexString,
      );
      expect(result.stealthAddress.toLowerCase()).toBe(v.output.stealthAddress.toLowerCase());
      expect(result.ephemeralPubKey).toBe(v.output.ephemeralPubKey);
      expect(result.viewTag).toBe(v.output.viewTag);
    });
  }
});

describe('evm vectors: scan_match', () => {
  for (const v of vectors.scan_match) {
    test(`stealth ${v.input.stealthAddress.slice(0, 10)}…`, () => {
      const result = checkStealthAddress(
        v.input.ephemeralPubKey as HexString,
        v.input.viewingKey as HexString,
        v.input.spendingPubKey as HexString,
        v.input.viewTag,
      );
      expect(result.isMatch).toBe(v.output.isMatch);
      expect(result.stealthAddress?.toLowerCase()).toBe(v.input.stealthAddress.toLowerCase());
    });
  }
});

describe('evm vectors: signing', () => {
  for (const v of vectors.signing) {
    test(`spendKey ${v.input.spendingKey.slice(0, 10)}…`, () => {
      const privKey = deriveStealthPrivateKey(
        v.input.spendingKey as HexString,
        v.input.ephemeralPubKey as HexString,
        v.input.viewingKey as HexString,
      );
      expect(privKey).toBe(v.output.stealthPrivateKey);
    });
  }
});

describe('evm vectors: encoding', () => {
  for (const v of vectors.encoding) {
    test(`spendPub ${v.input.spendingPubKey.slice(0, 10)}…`, () => {
      const meta = encodeStealthMetaAddress(
        v.input.spendingPubKey as HexString,
        v.input.viewingPubKey as HexString,
      );
      expect(meta).toBe(v.output.metaAddress);

      const decoded = decodeStealthMetaAddress(meta);
      expect(decoded.spendingPubKey).toBe(v.output.decodedSpendingPubKey);
      expect(decoded.viewingPubKey).toBe(v.output.decodedViewingPubKey);
    });
  }
});
