import { describe, test, expect } from 'vitest';
import { evmVectors } from '@wraith-protocol/test-vectors';
import {
  deriveStealthKeys,
  generateStealthAddress,
  deriveStealthPrivateKey,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
} from '../../src/chains/evm';
import type { HexString } from '../../src/chains/evm/types';

describe('EVM Test Vectors', () => {
  describe('Key Derivation', () => {
    test('all key derivation vectors pass', () => {
      for (const vector of evmVectors.keyDerivation) {
        const keys = deriveStealthKeys(vector.signature as HexString);
        expect(keys.spendingKey).toBe(vector.spendingKey);
        expect(keys.viewingKey).toBe(vector.viewingKey);
        expect(keys.spendingPubKey).toBe(vector.spendingPubKey);
        expect(keys.viewingPubKey).toBe(vector.viewingPubKey);
      }
    });
  });

  describe('Stealth Address Generation', () => {
    test('all stealth generation vectors pass', () => {
      for (const vector of evmVectors.stealthGeneration) {
        const stealth = generateStealthAddress(
          vector.spendingPubKey as HexString,
          vector.viewingPubKey as HexString,
          vector.ephemeralPrivateKey as HexString,
        );
        expect(stealth.ephemeralPubKey).toBe(vector.ephemeralPubKey);
        expect(stealth.stealthAddress).toBe(vector.stealthAddress);
        expect(stealth.viewTag).toBe(vector.viewTag);
      }
    });
  });

  describe('Scan Match', () => {
    test('all scan match vectors pass', () => {
      for (const vector of evmVectors.scanMatch) {
        if (vector.shouldMatch) {
          const stealthPrivateKey = deriveStealthPrivateKey(
            vector.spendingKey as HexString,
            vector.ephemeralPubKey as HexString,
            vector.viewingKey as HexString,
          );
          expect(stealthPrivateKey).toBe(vector.stealthPrivateKey);
        }
      }
    });
  });

  describe('Encoding', () => {
    test('all encoding vectors pass', () => {
      for (const vector of evmVectors.encoding) {
        const metaAddress = encodeStealthMetaAddress(
          vector.spendingPubKey as HexString,
          vector.viewingPubKey as HexString,
        );
        expect(metaAddress).toBe(vector.metaAddress);

        const decoded = decodeStealthMetaAddress(vector.metaAddress);
        expect(decoded.spendingPubKey).toBe(vector.spendingPubKey);
        expect(decoded.viewingPubKey).toBe(vector.viewingPubKey);
      }
    });
  });
});
