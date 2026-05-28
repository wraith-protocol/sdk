import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, expect } from 'vitest';
import { signWithScalar } from '../../../../src/chains/stellar/scalar';
import { bytesToHex, hexToBytes } from '../../../../src/chains/stellar/utils';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS_DIR = resolve(__dirname, '../../../../../packages/test-vectors/dist/stellar');

function hexToScalar(hex: string): bigint {
  const bytes = hexToBytes(hex);
  let scalar = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    scalar = (scalar << 8n) | BigInt(bytes[i]);
  }
  return scalar;
}

const file = JSON.parse(
  readFileSync(resolve(VECTORS_DIR, 'signing.json'), 'utf8'),
) as {
  vectors: Array<{
    id: string;
    scalar: string;
    publicKey: string;
    message: string;
    expected: { signature: string };
    tags: string[];
  }>;
};

describe('stellar signing vectors', () => {
  for (const v of file.vectors) {
    test(`${v.id} [${v.tags.join(', ')}]`, () => {
      const signature = signWithScalar(
        hexToBytes(v.message),
        hexToScalar(v.scalar),
        hexToBytes(v.publicKey),
      );
      expect(bytesToHex(signature)).toBe(v.expected.signature);
    });
  }
});
