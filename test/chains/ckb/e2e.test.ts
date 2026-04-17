import { describe, test, expect } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1';
import { toBytes, toHex } from 'viem';
import { deriveStealthKeys } from '../../../src/chains/ckb/keys';
import { generateStealthAddress } from '../../../src/chains/ckb/stealth';
import { checkStealthCell, scanStealthCells } from '../../../src/chains/ckb/scan';
import { deriveStealthPrivateKey } from '../../../src/chains/ckb/spend';
import {
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
} from '../../../src/chains/ckb/meta-address';
import { blake160 } from '../../../src/chains/ckb/blake';
import type { HexString, StealthCell } from '../../../src/chains/ckb/types';

const testSig = ('0x' + 'aa'.repeat(32) + 'bb'.repeat(32) + '1b') as HexString;

describe('e2e: full stealth payment flow on CKB', () => {
  test('derive → generate → scan → spend → verify', () => {
    const keys = deriveStealthKeys(testSig);

    const meta = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
    expect(meta).toMatch(/^st:ckb:/);

    const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(meta);

    const stealth = generateStealthAddress(spendingPubKey, viewingPubKey);
    expect(stealth.lockArgs.length).toBe(108);

    // Simulate a cell with these lock args
    const cell: StealthCell = {
      txHash: ('0x' + 'ff'.repeat(32)) as HexString,
      index: 0,
      capacity: 10000000000n,
      lockArgs: stealth.lockArgs,
      ephemeralPubKey: stealth.ephemeralPubKey,
      stealthPubKeyHash: stealth.stealthPubKeyHash,
    };

    // Check this cell matches
    const checkResult = checkStealthCell(cell.lockArgs, keys.viewingKey, keys.spendingPubKey);
    expect(checkResult.isMatch).toBe(true);

    // Scan and derive private key
    const matched = scanStealthCells(
      [cell],
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingKey,
    );
    expect(matched).toHaveLength(1);

    // Verify: derived private key produces the correct stealth pubkey hash
    const privKey = matched[0].stealthPrivateKey;
    const derivedPubKey = secp256k1.getPublicKey(toBytes(privKey), true);
    const derivedHash = toHex(blake160(derivedPubKey));
    expect(derivedHash).toBe(stealth.stealthPubKeyHash);

    // Verify independent derivation matches
    const independentKey = deriveStealthPrivateKey(
      keys.spendingKey,
      stealth.ephemeralPubKey,
      keys.viewingKey,
    );
    expect(independentKey).toBe(matched[0].stealthPrivateKey);
  });
});
