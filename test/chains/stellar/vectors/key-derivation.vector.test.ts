import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, expect } from 'vitest';
import { deriveStealthKeys } from '../../../../src/chains/stellar/keys';
import { bytesToHex, hexToBytes } from '../../../../src/chains/stellar/utils';
import { scalarToBytes } from '../../../../src/chains/stellar/scalar';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS_DIR = resolve(__dirname, '../../../../../packages/test-vectors/dist/stellar');

const file = JSON.parse(
  readFileSync(resolve(VECTORS_DIR, 'key-derivation.json'), 'utf8'),
) as {
  vectors: Array<{
    id: string;
    signature: string;
    expected: {
      spendingKey: string;
      viewingKey: string;
      spendingScalar: string;
      viewingScalar: string;
      spendingPubKey: string;
      viewingPubKey: string;
    };
    tags: string[];
  }>;
};

describe('stellar key-derivation vectors', () => {
  for (const v of file.vectors) {
    test(`${v.id}${v.tags.length ? ` [${v.tags.join(', ')}]` : ''}`, () => {
      const keys = deriveStealthKeys(hexToBytes(v.signature));

      expect(bytesToHex(keys.spendingKey)).toBe(v.expected.spendingKey);
      expect(bytesToHex(keys.viewingKey)).toBe(v.expected.viewingKey);
      expect(bytesToHex(scalarToBytes(keys.spendingScalar))).toBe(v.expected.spendingScalar);
      expect(bytesToHex(scalarToBytes(keys.viewingScalar))).toBe(v.expected.viewingScalar);
      expect(bytesToHex(keys.spendingPubKey)).toBe(v.expected.spendingPubKey);
      expect(bytesToHex(keys.viewingPubKey)).toBe(v.expected.viewingPubKey);
    });
  }
});
