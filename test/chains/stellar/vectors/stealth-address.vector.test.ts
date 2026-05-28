import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, expect } from 'vitest';
import { generateStealthAddress } from '../../../../src/chains/stellar/stealth';
import { bytesToHex, hexToBytes } from '../../../../src/chains/stellar/utils';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS_DIR = resolve(__dirname, '../../../../../packages/test-vectors/dist/stellar');

const file = JSON.parse(
  readFileSync(resolve(VECTORS_DIR, 'stealth-address.json'), 'utf8'),
) as {
  vectors: Array<{
    id: string;
    spendingPubKey: string;
    viewingPubKey: string;
    ephemeralPrivateKey: string;
    expected: { stealthAddress: string; ephemeralPubKey: string; viewTag: number };
  }>;
};

describe('stellar stealth-address vectors', () => {
  for (const v of file.vectors) {
    test(v.id, () => {
      const result = generateStealthAddress(
        hexToBytes(v.spendingPubKey),
        hexToBytes(v.viewingPubKey),
        hexToBytes(v.ephemeralPrivateKey),
      );

      expect(result.stealthAddress).toBe(v.expected.stealthAddress);
      expect(bytesToHex(result.ephemeralPubKey)).toBe(v.expected.ephemeralPubKey);
      expect(result.viewTag).toBe(v.expected.viewTag);
    });
  }
});
