import { describe, test, expect } from 'vitest';
import { deriveStealthKeys } from '../../../src/chains/ckb/keys';
import { generateStealthAddress } from '../../../src/chains/ckb/stealth';
import { checkStealthCell, scanStealthCells } from '../../../src/chains/ckb/scan';
import type { HexString, StealthCell } from '../../../src/chains/ckb/types';

const testSig = ('0x' + 'aa'.repeat(32) + 'bb'.repeat(32) + '1b') as HexString;

function makeCell(lockArgs: HexString): StealthCell {
  return {
    txHash: ('0x' + '00'.repeat(32)) as HexString,
    index: 0,
    capacity: 10000000000n,
    lockArgs,
    ephemeralPubKey: ('0x' + lockArgs.slice(2, 68)) as HexString,
    stealthPubKeyHash: ('0x' + lockArgs.slice(68)) as HexString,
  };
}

describe('checkStealthCell', () => {
  test('matches own cell', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    const result = checkStealthCell(stealth.lockArgs, keys.viewingKey, keys.spendingPubKey);

    expect(result.isMatch).toBe(true);
    expect(result.stealthPubKeyHash).toBe(stealth.stealthPubKeyHash);
  });

  test('rejects wrong viewing key', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    const otherSig = ('0x' + '11'.repeat(32) + '22'.repeat(32) + '1c') as HexString;
    const otherKeys = deriveStealthKeys(otherSig);

    const result = checkStealthCell(stealth.lockArgs, otherKeys.viewingKey, keys.spendingPubKey);

    expect(result.isMatch).toBe(false);
  });

  test('rejects wrong length args', () => {
    const keys = deriveStealthKeys(testSig);
    const shortArgs = ('0x' + 'aa'.repeat(40)) as HexString;

    const result = checkStealthCell(shortArgs, keys.viewingKey, keys.spendingPubKey);

    expect(result.isMatch).toBe(false);
  });
});

describe('scanStealthCells', () => {
  test('finds matching cells', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    const cells: StealthCell[] = [makeCell(stealth.lockArgs)];

    const matched = scanStealthCells(cells, keys.viewingKey, keys.spendingPubKey, keys.spendingKey);
    expect(matched).toHaveLength(1);
    expect(matched[0].stealthPrivateKey).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test('filters mix of own and foreign cells', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    const otherSig = ('0x' + '11'.repeat(32) + '22'.repeat(32) + '1c') as HexString;
    const otherKeys = deriveStealthKeys(otherSig);
    const otherStealth = generateStealthAddress(otherKeys.spendingPubKey, otherKeys.viewingPubKey);

    const cells: StealthCell[] = [makeCell(stealth.lockArgs), makeCell(otherStealth.lockArgs)];

    const matched = scanStealthCells(cells, keys.viewingKey, keys.spendingPubKey, keys.spendingKey);
    expect(matched).toHaveLength(1);
  });
});
