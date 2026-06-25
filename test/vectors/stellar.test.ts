import { describe, test, expect } from 'vitest';
import { stellarVectors } from '@wraith-protocol/test-vectors';
import {
  deriveStealthKeys,
  generateStealthAddress,
  deriveStealthPrivateScalar,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  hexToBytes,
  bytesToHex,
} from '../../src/chains/stellar';

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(base64, 'base64'));
}

describe('Stellar Test Vectors', () => {
  describe('Key Derivation', () => {
    test('all key derivation vectors pass', () => {
      for (const vector of stellarVectors.keyDerivation) {
        const signature = base64ToBytes(vector.signature);
        const keys = deriveStealthKeys(signature);

        expect(bytesToHex(keys.spendingKey)).toBe(vector.spendingKey);
        expect(bytesToHex(keys.viewingKey)).toBe(vector.viewingKey);
        expect(Buffer.from(keys.spendingPubKey).toString('base64')).toBe(vector.spendingPubKey);
        expect(Buffer.from(keys.viewingPubKey).toString('base64')).toBe(vector.viewingPubKey);
        expect('0x' + keys.spendingScalar.toString(16).padStart(64, '0')).toBe(
          vector.spendingScalar,
        );
        expect('0x' + keys.viewingScalar.toString(16).padStart(64, '0')).toBe(vector.viewingScalar);
      }
    });
  });

  describe('Stealth Address Generation', () => {
    test('all stealth generation vectors pass', () => {
      for (const vector of stellarVectors.stealthGeneration) {
        const spendingPubKey = base64ToBytes(vector.spendingPubKey);
        const viewingPubKey = base64ToBytes(vector.viewingPubKey);
        const ephemeralSeed = hexToBytes(vector.ephemeralPrivateKey);

        const stealth = generateStealthAddress(spendingPubKey, viewingPubKey, ephemeralSeed);

        expect(Buffer.from(stealth.ephemeralPubKey).toString('base64')).toBe(
          vector.ephemeralPubKey,
        );
        expect(stealth.stealthAddress).toBe(vector.stealthAddress);
        expect(stealth.viewTag).toBe(vector.viewTag);
      }
    });
  });

  describe('Scan Match', () => {
    test('stealth private scalar derivation works', () => {
      // Test a subset where we know the relationship
      for (let i = 0; i < 10; i++) {
        const kdVector = stellarVectors.keyDerivation[i];
        const sgVector = stellarVectors.stealthGeneration[i];
        const smVector = stellarVectors.scanMatch.find(
          (v) => v.ephemeralPubKey === sgVector.ephemeralPubKey && v.shouldMatch,
        );

        if (!smVector || !smVector.stealthPrivateScalar) continue;

        const signature = base64ToBytes(kdVector.signature);
        const keys = deriveStealthKeys(signature);
        const ephemeralPubKey = base64ToBytes(sgVector.ephemeralPubKey);

        const stealthPrivateScalar = deriveStealthPrivateScalar(
          keys.spendingScalar,
          keys.viewingKey,
          ephemeralPubKey,
        );

        expect('0x' + stealthPrivateScalar.toString(16).padStart(64, '0')).toBe(
          smVector.stealthPrivateScalar,
        );
      }
    });
  });

  describe('Encoding', () => {
    test('all encoding vectors pass', () => {
      for (const vector of stellarVectors.encoding) {
        const spendingPubKey = base64ToBytes(vector.spendingPubKey);
        const viewingPubKey = base64ToBytes(vector.viewingPubKey);

        const metaAddress = encodeStealthMetaAddress(spendingPubKey, viewingPubKey);
        expect(metaAddress).toBe(vector.metaAddress);

        const decoded = decodeStealthMetaAddress(vector.metaAddress);
        expect(Buffer.from(decoded.spendingPubKey).toString('base64')).toBe(vector.spendingPubKey);
        expect(Buffer.from(decoded.viewingPubKey).toString('base64')).toBe(vector.viewingPubKey);
      }
    });
  });
});
