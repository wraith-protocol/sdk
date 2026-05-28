import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, expect } from 'vitest';
import { checkStealthAddress } from '../../../../src/chains/stellar/scan';
import { deriveStealthPrivateScalar } from '../../../../src/chains/stellar/spend';
import { scalarToBytes } from '../../../../src/chains/stellar/scalar';
import { bytesToHex, hexToBytes } from '../../../../src/chains/stellar/utils';
import { SCHEME_ID } from '../../../../src/chains/stellar/constants';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS_DIR = resolve(__dirname, '../../../../../packages/test-vectors/dist/stellar');

interface ScanVector {
  id: string;
  description: string;
  announcement: {
    schemeId: number;
    stealthAddress: string;
    caller: string;
    ephemeralPubKey: string;
    metadata: string;
  };
  viewingKey: string;
  spendingPubKey: string;
  spendingScalar: string;
  expected: {
    isMatch: boolean;
    stealthAddress: string | null;
    stealthPrivateScalar: string | null;
  };
  tags: string[];
}

function hexToScalar(hex: string): bigint {
  const bytes = hexToBytes(hex);
  let scalar = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    scalar = (scalar << 8n) | BigInt(bytes[i]);
  }
  return scalar;
}

const file = JSON.parse(
  readFileSync(resolve(VECTORS_DIR, 'scan-match.json'), 'utf8'),
) as { vectors: ScanVector[] };

describe('stellar scan-match vectors', () => {
  for (const v of file.vectors) {
    test(`${v.id}: ${v.description}`, () => {
      if (v.announcement.schemeId !== SCHEME_ID) {
        expect(v.expected.isMatch).toBe(false);
        return;
      }

      const ephemeralPubKey = hexToBytes(v.announcement.ephemeralPubKey);
      const viewingKey = hexToBytes(v.viewingKey);
      const spendingPubKey = hexToBytes(v.spendingPubKey);
      const viewTag = hexToBytes(v.announcement.metadata)[0];

      const result = checkStealthAddress(ephemeralPubKey, viewingKey, spendingPubKey, viewTag);

      if (!v.expected.isMatch) {
        expect(result.isMatch).toBe(false);
        return;
      }

      expect(result.isMatch).toBe(true);
      expect(result.stealthAddress).toBe(v.expected.stealthAddress);

      const stealthPrivScalar = deriveStealthPrivateScalar(
        hexToScalar(v.spendingScalar),
        viewingKey,
        ephemeralPubKey,
      );
      expect(bytesToHex(scalarToBytes(stealthPrivScalar))).toBe(v.expected.stealthPrivateScalar);
    });
  }
});
