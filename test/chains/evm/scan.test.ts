import { describe, test, expect } from 'vitest';
import { deriveStealthKeys } from '../../../src/chains/evm/keys';
import { generateStealthAddress } from '../../../src/chains/evm/stealth';
import { checkStealthAddress, scanAnnouncements } from '../../../src/chains/evm/scan';
import { SCHEME_ID } from '../../../src/chains/evm/constants';
import type { HexString, Announcement } from '../../../src/chains/evm/types';

const testSig = ('0x' + 'aa'.repeat(32) + 'bb'.repeat(32) + '1b') as HexString;

describe('checkStealthAddress', () => {
  test('matches own announcement', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    const result = checkStealthAddress(
      stealth.ephemeralPubKey,
      keys.viewingKey,
      keys.spendingPubKey,
      stealth.viewTag,
    );

    expect(result.isMatch).toBe(true);
    expect(result.stealthAddress?.toLowerCase()).toBe(stealth.stealthAddress.toLowerCase());
  });

  test('rejects wrong view tag', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    const wrongTag = (stealth.viewTag + 1) % 256;
    const result = checkStealthAddress(
      stealth.ephemeralPubKey,
      keys.viewingKey,
      keys.spendingPubKey,
      wrongTag,
    );

    expect(result.isMatch).toBe(false);
    expect(result.stealthAddress).toBeNull();
  });

  test('rejects wrong viewing key', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    const otherSig = ('0x' + '11'.repeat(32) + '22'.repeat(32) + '1c') as HexString;
    const otherKeys = deriveStealthKeys(otherSig);

    const result = checkStealthAddress(
      stealth.ephemeralPubKey,
      otherKeys.viewingKey,
      keys.spendingPubKey,
      stealth.viewTag,
    );

    // May or may not match view tag by coincidence, but address won't match
    if (result.isMatch) {
      expect(result.stealthAddress?.toLowerCase()).not.toBe(stealth.stealthAddress.toLowerCase());
    }
  });
});

describe('scanAnnouncements', () => {
  test('finds matching payments', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    const announcements: Announcement[] = [
      {
        schemeId: SCHEME_ID,
        stealthAddress: stealth.stealthAddress,
        caller: ('0x' + '00'.repeat(20)) as HexString,
        ephemeralPubKey: stealth.ephemeralPubKey,
        metadata: ('0x' + stealth.viewTag.toString(16).padStart(2, '0')) as HexString,
      },
    ];

    const matched = scanAnnouncements(
      announcements,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingKey,
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].stealthAddress.toLowerCase()).toBe(stealth.stealthAddress.toLowerCase());
    expect(matched[0].stealthPrivateKey).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test('skips wrong scheme ID', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    const announcements: Announcement[] = [
      {
        schemeId: 99n,
        stealthAddress: stealth.stealthAddress,
        caller: ('0x' + '00'.repeat(20)) as HexString,
        ephemeralPubKey: stealth.ephemeralPubKey,
        metadata: ('0x' + stealth.viewTag.toString(16).padStart(2, '0')) as HexString,
      },
    ];

    const matched = scanAnnouncements(
      announcements,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingKey,
    );
    expect(matched).toHaveLength(0);
  });

  test('filters mix of own and foreign announcements', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    const otherSig = ('0x' + '11'.repeat(32) + '22'.repeat(32) + '1c') as HexString;
    const otherKeys = deriveStealthKeys(otherSig);
    const otherStealth = generateStealthAddress(otherKeys.spendingPubKey, otherKeys.viewingPubKey);

    const announcements: Announcement[] = [
      {
        schemeId: SCHEME_ID,
        stealthAddress: stealth.stealthAddress,
        caller: ('0x' + '00'.repeat(20)) as HexString,
        ephemeralPubKey: stealth.ephemeralPubKey,
        metadata: ('0x' + stealth.viewTag.toString(16).padStart(2, '0')) as HexString,
      },
      {
        schemeId: SCHEME_ID,
        stealthAddress: otherStealth.stealthAddress,
        caller: ('0x' + '00'.repeat(20)) as HexString,
        ephemeralPubKey: otherStealth.ephemeralPubKey,
        metadata: ('0x' + otherStealth.viewTag.toString(16).padStart(2, '0')) as HexString,
      },
    ];

    const matched = scanAnnouncements(
      announcements,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingKey,
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].stealthAddress.toLowerCase()).toBe(stealth.stealthAddress.toLowerCase());
  });
});
