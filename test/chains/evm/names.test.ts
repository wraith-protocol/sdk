import { describe, test, expect } from 'vitest';
import { deriveStealthKeys } from '../../../src/chains/evm/keys';
import { encodeStealthMetaAddress } from '../../../src/chains/evm/meta-address';
import {
  signNameRegistration,
  signNameRegistrationOnBehalf,
  signNameUpdate,
  signNameRelease,
  metaAddressToBytes,
} from '../../../src/chains/evm/names';
import type { HexString } from '../../../src/chains/evm/types';

const testSig = ('0x' + 'aa'.repeat(32) + 'bb'.repeat(32) + '1b') as HexString;

describe('names', () => {
  test('metaAddressToBytes strips prefix', () => {
    const keys = deriveStealthKeys(testSig);
    const meta = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
    const bytes = metaAddressToBytes(meta);

    expect(bytes).toMatch(/^0x[0-9a-f]+$/);
    expect(bytes.length).toBe(2 + 132); // 0x + 132 hex chars
  });

  test('metaAddressToBytes rejects invalid format', () => {
    expect(() => metaAddressToBytes('invalid')).toThrow('Invalid meta-address format');
  });

  test('signNameRegistration produces valid signature', () => {
    const keys = deriveStealthKeys(testSig);
    const meta = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
    const metaBytes = metaAddressToBytes(meta);

    const sig = signNameRegistration('alice', metaBytes, keys.spendingKey);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/); // 65 bytes = 130 hex
  });

  test('signNameRegistrationOnBehalf produces different sig than without nonce', () => {
    const keys = deriveStealthKeys(testSig);
    const meta = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
    const metaBytes = metaAddressToBytes(meta);

    const sig1 = signNameRegistration('alice', metaBytes, keys.spendingKey);
    const sig2 = signNameRegistrationOnBehalf('alice', metaBytes, keys.spendingKey, 0n);

    expect(sig1).not.toBe(sig2);
  });

  test('signNameUpdate produces valid signature', () => {
    const keys = deriveStealthKeys(testSig);
    const meta = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
    const metaBytes = metaAddressToBytes(meta);

    const sig = signNameUpdate('alice', metaBytes, keys.spendingKey);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });

  test('signNameRelease produces valid signature', () => {
    const keys = deriveStealthKeys(testSig);
    const sig = signNameRelease('alice', keys.spendingKey);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });
});
