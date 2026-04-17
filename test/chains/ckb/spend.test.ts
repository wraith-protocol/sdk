import { describe, test, expect } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1';
import { toBytes, toHex } from 'viem';
import { deriveStealthKeys } from '../../../src/chains/ckb/keys';
import { generateStealthAddress } from '../../../src/chains/ckb/stealth';
import { deriveStealthPrivateKey } from '../../../src/chains/ckb/spend';
import { blake160 } from '../../../src/chains/ckb/blake';
import type { HexString } from '../../../src/chains/ckb/types';

const testSig = ('0x' + 'aa'.repeat(32) + 'bb'.repeat(32) + '1b') as HexString;
const fixedEphKey = ('0x' + 'cc'.repeat(32)) as HexString;

describe('deriveStealthPrivateKey', () => {
  test('returns valid 32-byte hex', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedEphKey);
    const privKey = deriveStealthPrivateKey(
      keys.spendingKey,
      stealth.ephemeralPubKey,
      keys.viewingKey,
    );

    expect(privKey).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test('derived key produces matching blake160 pubkey hash', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedEphKey);
    const privKey = deriveStealthPrivateKey(
      keys.spendingKey,
      stealth.ephemeralPubKey,
      keys.viewingKey,
    );

    const derivedPubKey = secp256k1.getPublicKey(toBytes(privKey), true);
    const derivedHash = toHex(blake160(derivedPubKey));

    expect(derivedHash).toBe(stealth.stealthPubKeyHash);
  });

  test('deterministic', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedEphKey);
    const k1 = deriveStealthPrivateKey(keys.spendingKey, stealth.ephemeralPubKey, keys.viewingKey);
    const k2 = deriveStealthPrivateKey(keys.spendingKey, stealth.ephemeralPubKey, keys.viewingKey);

    expect(k1).toBe(k2);
  });
});
