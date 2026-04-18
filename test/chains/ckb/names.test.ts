import { describe, test, expect } from 'vitest';
import { deriveStealthKeys } from '../../../src/chains/ckb/keys';
import {
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
} from '../../../src/chains/ckb/meta-address';
import {
  hashName,
  buildRegisterName,
  buildResolveName,
  metaAddressFromNameData,
} from '../../../src/chains/ckb/names';
import { DEPLOYMENTS } from '../../../src/chains/ckb/deployments';
import type { HexString } from '../../../src/chains/ckb/types';

const testSig = ('0x' + 'aa'.repeat(32) + 'bb'.repeat(32) + '1b') as HexString;

describe('hashName', () => {
  test('produces 32-byte hex', () => {
    const hash = hashName('alice');
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test('is deterministic', () => {
    const hash1 = hashName('alice');
    const hash2 = hashName('alice');
    expect(hash1).toBe(hash2);
  });

  test('different names produce different hashes', () => {
    const hash1 = hashName('alice');
    const hash2 = hashName('bob');
    expect(hash1).not.toBe(hash2);
  });

  test('rejects names that are too short', () => {
    expect(() => hashName('ab')).toThrow('between 3 and 32 characters');
  });

  test('rejects names that are too long', () => {
    expect(() => hashName('a'.repeat(33))).toThrow('between 3 and 32 characters');
  });

  test('rejects uppercase characters', () => {
    expect(() => hashName('Alice')).toThrow('lowercase alphanumeric');
  });

  test('rejects special characters', () => {
    expect(() => hashName('al!ce')).toThrow('lowercase alphanumeric');
  });

  test('rejects names starting with a hyphen', () => {
    expect(() => hashName('-alice')).toThrow('lowercase alphanumeric');
  });

  test('rejects names ending with a hyphen', () => {
    expect(() => hashName('alice-')).toThrow('lowercase alphanumeric');
  });

  test('accepts valid names with hyphens', () => {
    const hash = hashName('my-name');
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('buildRegisterName', () => {
  test('returns correct type script and 66-byte data', () => {
    const keys = deriveStealthKeys(testSig);
    const result = buildRegisterName({
      name: 'alice',
      spendingPubKey: keys.spendingPubKey,
      viewingPubKey: keys.viewingPubKey,
    });

    expect(result.typeScript.codeHash).toBe(DEPLOYMENTS.ckb.contracts.namesTypeCodeHash);
    expect(result.typeScript.hashType).toBe('type');
    expect(result.typeScript.args).toBe(hashName('alice'));

    const dataHex = result.data.slice(2);
    expect(dataHex.length).toBe(132);
  });

  test('data contains spending and viewing public keys', () => {
    const keys = deriveStealthKeys(testSig);
    const result = buildRegisterName({
      name: 'alice',
      spendingPubKey: keys.spendingPubKey,
      viewingPubKey: keys.viewingPubKey,
    });

    const dataHex = result.data.slice(2);
    const spendHex = keys.spendingPubKey.slice(2);
    const viewHex = keys.viewingPubKey.slice(2);
    expect(dataHex).toBe(spendHex + viewHex);
  });

  test('rejects invalid key lengths', () => {
    const shortKey = ('0x' + 'aa'.repeat(32)) as HexString;
    const keys = deriveStealthKeys(testSig);
    expect(() =>
      buildRegisterName({
        name: 'alice',
        spendingPubKey: shortKey,
        viewingPubKey: keys.viewingPubKey,
      }),
    ).toThrow('33 bytes');
  });
});

describe('buildResolveName', () => {
  test('returns correct type script with name hash as args', () => {
    const result = buildResolveName({ name: 'alice' });

    expect(result.typeScript.codeHash).toBe(DEPLOYMENTS.ckb.contracts.namesTypeCodeHash);
    expect(result.typeScript.hashType).toBe('type');
    expect(result.typeScript.args).toBe(hashName('alice'));
  });

  test('different names produce different args', () => {
    const result1 = buildResolveName({ name: 'alice' });
    const result2 = buildResolveName({ name: 'bob' });

    expect(result1.typeScript.args).not.toBe(result2.typeScript.args);
  });
});

describe('metaAddressFromNameData', () => {
  test('roundtrips with encodeStealthMetaAddress', () => {
    const keys = deriveStealthKeys(testSig);
    const meta = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);

    const result = buildRegisterName({
      name: 'alice',
      spendingPubKey: keys.spendingPubKey,
      viewingPubKey: keys.viewingPubKey,
    });

    const recovered = metaAddressFromNameData(result.data);
    expect(recovered).toBe(meta);

    const decoded = decodeStealthMetaAddress(recovered);
    expect(decoded.spendingPubKey).toBe(keys.spendingPubKey);
    expect(decoded.viewingPubKey).toBe(keys.viewingPubKey);
  });

  test('rejects wrong data length', () => {
    const shortData = ('0x' + 'aa'.repeat(33)) as HexString;
    expect(() => metaAddressFromNameData(shortData)).toThrow('exactly 66 bytes');
  });
});
