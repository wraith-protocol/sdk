import { describe, test, expect } from 'vitest';
import { deriveStealthKeys } from '../../../src/chains/solana/keys';
import { generateStealthAddress } from '../../../src/chains/solana/stealth';
import { checkStealthAddress, scanAnnouncements } from '../../../src/chains/solana/scan';
import { SCHEME_ID } from '../../../src/chains/solana/constants';
import { bytesToHex } from '../../../src/chains/solana/utils';
import type { Announcement } from '../../../src/chains/solana/types';

const testSig = new Uint8Array(64).fill(0xaa);

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
    expect(result.stealthAddress).toBe(stealth.stealthAddress);
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

    const otherSig = new Uint8Array(64).fill(0xbb);
    const otherKeys = deriveStealthKeys(otherSig);

    const result = checkStealthAddress(
      stealth.ephemeralPubKey,
      otherKeys.viewingKey,
      keys.spendingPubKey,
      stealth.viewTag,
    );

    if (result.isMatch) {
      expect(result.stealthAddress).not.toBe(stealth.stealthAddress);
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
        caller: '11111111111111111111111111111111',
        ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
        metadata: stealth.viewTag.toString(16).padStart(2, '0'),
      },
    ];

    const matched = scanAnnouncements(
      announcements,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingScalar,
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].stealthAddress).toBe(stealth.stealthAddress);
    expect(typeof matched[0].stealthPrivateScalar).toBe('bigint');
    expect(matched[0].stealthPubKeyBytes).toBeInstanceOf(Uint8Array);
  });

  test('skips wrong scheme ID', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    const announcements: Announcement[] = [
      {
        schemeId: 99,
        stealthAddress: stealth.stealthAddress,
        caller: '11111111111111111111111111111111',
        ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
        metadata: stealth.viewTag.toString(16).padStart(2, '0'),
      },
    ];

    const matched = scanAnnouncements(
      announcements,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingScalar,
    );
    expect(matched).toHaveLength(0);
  });

  test('filters mix of own and foreign announcements', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    const otherSig = new Uint8Array(64).fill(0xbb);
    const otherKeys = deriveStealthKeys(otherSig);
    const otherStealth = generateStealthAddress(otherKeys.spendingPubKey, otherKeys.viewingPubKey);

    const announcements: Announcement[] = [
      {
        schemeId: SCHEME_ID,
        stealthAddress: stealth.stealthAddress,
        caller: '11111111111111111111111111111111',
        ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
        metadata: stealth.viewTag.toString(16).padStart(2, '0'),
      },
      {
        schemeId: SCHEME_ID,
        stealthAddress: otherStealth.stealthAddress,
        caller: '11111111111111111111111111111111',
        ephemeralPubKey: bytesToHex(otherStealth.ephemeralPubKey),
        metadata: otherStealth.viewTag.toString(16).padStart(2, '0'),
      },
    ];

    const matched = scanAnnouncements(
      announcements,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingScalar,
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].stealthAddress).toBe(stealth.stealthAddress);
  });
});
