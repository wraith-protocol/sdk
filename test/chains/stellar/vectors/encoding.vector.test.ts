import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, expect } from 'vitest';
import { encodeStealthMetaAddress, decodeStealthMetaAddress } from '../../../../src/chains/stellar/meta-address';
import { bytesToHex, hexToBytes } from '../../../../src/chains/stellar/utils';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS_DIR = resolve(__dirname, '../../../../../packages/test-vectors/dist/stellar');

const file = JSON.parse(
  readFileSync(resolve(VECTORS_DIR, 'encoding.json'), 'utf8'),
) as {
  vectors: Array<{
    id: string;
    spendingPubKey: string;
    viewingPubKey: string;
    expected: { metaAddress: string };
  }>;
};

describe('stellar encoding vectors', () => {
  for (const v of file.vectors) {
    test(`${v.id}: encode matches expected`, () => {
      const spendingPubKey = hexToBytes(v.spendingPubKey);
      const viewingPubKey = hexToBytes(v.viewingPubKey);

      const metaAddress = encodeStealthMetaAddress(spendingPubKey, viewingPubKey);
      expect(metaAddress).toBe(v.expected.metaAddress);
    });

    test(`${v.id}: decode round-trip`, () => {
      const decoded = decodeStealthMetaAddress(v.expected.metaAddress);
      expect(bytesToHex(decoded.spendingPubKey)).toBe(v.spendingPubKey);
      expect(bytesToHex(decoded.viewingPubKey)).toBe(v.viewingPubKey);
    });
  }
});
