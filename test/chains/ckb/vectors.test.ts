import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { deriveStealthKeys } from '../../../src/chains/ckb/keys';
import { generateStealthAddress } from '../../../src/chains/ckb/stealth';
import { checkStealthCell } from '../../../src/chains/ckb/scan';
import { deriveStealthPrivateKey } from '../../../src/chains/ckb/spend';
import {
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
} from '../../../src/chains/ckb/meta-address';
import type { HexString } from '../../../src/chains/ckb/types';

const vectors = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../../packages/test-vectors/vectors/ckb.json'),
    'utf8',
  ),
);

describe('ckb vectors: key_derivation', () => {
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

describe('ckb vectors: stealth_gen', () => {
  for (const v of vectors.stealth_gen) {
    test(`ephKey ${v.input.ephemeralPrivateKey.slice(0, 10)}…`, () => {
      const result = generateStealthAddress(
        v.input.spendingPubKey as HexString,
        v.input.viewingPubKey as HexString,
        v.input.ephemeralPrivateKey as HexString,
      );
      expect(result.stealthPubKey).toBe(v.output.stealthPubKey);
      expect(result.stealthPubKeyHash).toBe(v.output.stealthPubKeyHash);
      expect(result.ephemeralPubKey).toBe(v.output.ephemeralPubKey);
      expect(result.lockArgs).toBe(v.output.lockArgs);
    });
  }
});

describe('ckb vectors: scan_match', () => {
  for (const v of vectors.scan_match) {
    test(`lockArgs ${v.input.lockArgs.slice(0, 10)}…`, () => {
      const result = checkStealthCell(
        v.input.lockArgs as HexString,
        v.input.viewingKey as HexString,
        v.input.spendingPubKey as HexString,
      );
      expect(result.isMatch).toBe(v.output.isMatch);
      expect(result.stealthPubKeyHash).toBe(v.output.stealthPubKeyHash);
    });
  }
});

describe('ckb vectors: signing', () => {
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

describe('ckb vectors: encoding', () => {
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
