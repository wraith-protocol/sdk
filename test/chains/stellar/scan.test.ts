import { describe, test, expect } from 'vitest';
import { deriveStealthKeys } from '../../../src/chains/stellar/keys';
import {
  computeAnnouncementViewTag,
  computeSharedSecret,
  computeViewTag,
  generateStealthAddress,
} from '../../../src/chains/stellar/stealth';
import {
  checkStealthAddress,
  scanAnnouncements,
  scanAnnouncementsLegacySharedSecretTag,
} from '../../../src/chains/stellar/scan';
import { SCHEME_ID } from '../../../src/chains/stellar/constants';
import { bytesToHex } from '../../../src/chains/stellar/utils';
import type { Announcement } from '../../../src/chains/stellar/types';

const testSig = new Uint8Array(64).fill(0xaa);

describe('checkStealthAddress', () => {
  test('matches own announcement', async () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = await generateStealthAddress(
      keys.spendingPubKey,
      keys.viewingPubKey,
    );

    const result = await checkStealthAddress(
      stealth.ephemeralPubKey,
      keys.viewingKey,
      keys.spendingPubKey,
      stealth.viewTag,
    );

    expect(result.isMatch).toBe(true);
    expect(result.stealthAddress).toBe(stealth.stealthAddress);
  });

  test('rejects wrong view tag', async () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = await generateStealthAddress(
      keys.spendingPubKey,
      keys.viewingPubKey,
    );

    const wrongTag = (stealth.viewTag + 1) % 256;
    const result = await checkStealthAddress(
      stealth.ephemeralPubKey,
      keys.viewingKey,
      keys.spendingPubKey,
      wrongTag,
    );

    expect(result.isMatch).toBe(false);
    expect(result.stealthAddress).toBeNull();
  });

  test('rejects wrong viewing key', async () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = await generateStealthAddress(
      keys.spendingPubKey,
      keys.viewingPubKey,
    );

    const otherSig = new Uint8Array(64).fill(0xbb);
    const otherKeys = deriveStealthKeys(otherSig);

    const result = await checkStealthAddress(
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
  test('finds matching payments', async () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = await generateStealthAddress(
      keys.spendingPubKey,
      keys.viewingPubKey,
    );

    const announcements: Announcement[] = [
      {
        schemeId: SCHEME_ID,
        stealthAddress: stealth.stealthAddress,
        caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
        metadata: stealth.viewTag.toString(16).padStart(2, '0'),
      },
    ];

    const matched = await scanAnnouncements(
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

  test('skips wrong scheme ID', async () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = await generateStealthAddress(
      keys.spendingPubKey,
      keys.viewingPubKey,
    );

    const announcements: Announcement[] = [
      {
        schemeId: 99,
        stealthAddress: stealth.stealthAddress,
        caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
        metadata: stealth.viewTag.toString(16).padStart(2, '0'),
      },
    ];

    const matched = await scanAnnouncements(
      announcements,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingScalar,
    );
    expect(matched).toHaveLength(0);
  });

  test('skips invalid ephemeral keys even when the public view tag matches', async () => {
    const keys = deriveStealthKeys(testSig);
    const invalidEphemeralPubKey = new Uint8Array(32);
    const matchingPublicTag = computeAnnouncementViewTag(
      invalidEphemeralPubKey,
      keys.viewingPubKey,
    );

    const announcements: Announcement[] = [
      {
        schemeId: SCHEME_ID,
        stealthAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        ephemeralPubKey: bytesToHex(invalidEphemeralPubKey),
        metadata: matchingPublicTag.toString(16).padStart(2, '0'),
      },
    ];

    const matched = await scanAnnouncements(
      announcements,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingScalar,
    );

    expect(matched).toHaveLength(0);
  });

  test('keeps legacy shared-secret view tags on the legacy scanner path', async () => {
    const keys = deriveStealthKeys(testSig);
    let ephemeralSeed = new Uint8Array(32).fill(0x11);
    let stealth = await generateStealthAddress(
      keys.spendingPubKey,
      keys.viewingPubKey,
      ephemeralSeed,
    );
    let sharedSecret = computeSharedSecret(ephemeralSeed, keys.viewingPubKey);
    let legacyTag = computeViewTag(sharedSecret);

    // Use a deterministic seed whose legacy shared-secret tag differs from the
    // optimized public-announcement tag so the migration boundary is explicit.
    for (let i = 0; legacyTag === stealth.viewTag && i < 255; i++) {
      ephemeralSeed = new Uint8Array(32).fill(0x12 + i);
      stealth = await generateStealthAddress(
        keys.spendingPubKey,
        keys.viewingPubKey,
        ephemeralSeed,
      );
      sharedSecret = computeSharedSecret(ephemeralSeed, keys.viewingPubKey);
      legacyTag = computeViewTag(sharedSecret);
    }

    expect(legacyTag).not.toBe(stealth.viewTag);

    const announcements: Announcement[] = [
      {
        schemeId: SCHEME_ID,
        stealthAddress: stealth.stealthAddress,
        caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
        metadata: legacyTag.toString(16).padStart(2, '0'),
      },
    ];

    expect(
      await scanAnnouncements(
        announcements,
        keys.viewingKey,
        keys.spendingPubKey,
        keys.spendingScalar,
      ),
    ).toHaveLength(0);

    const legacyMatched = await scanAnnouncementsLegacySharedSecretTag(
      announcements,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingScalar,
    );

    expect(legacyMatched).toHaveLength(1);
    expect(legacyMatched[0].stealthAddress).toBe(stealth.stealthAddress);
  });

  test('filters mix of own and foreign announcements', async () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = await generateStealthAddress(
      keys.spendingPubKey,
      keys.viewingPubKey,
    );

    const otherSig = new Uint8Array(64).fill(0xbb);
    const otherKeys = deriveStealthKeys(otherSig);
    const otherStealth = await generateStealthAddress(
      otherKeys.spendingPubKey,
      otherKeys.viewingPubKey,
    );

    const announcements: Announcement[] = [
      {
        schemeId: SCHEME_ID,
        stealthAddress: stealth.stealthAddress,
        caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
        metadata: stealth.viewTag.toString(16).padStart(2, '0'),
      },
      {
        schemeId: SCHEME_ID,
        stealthAddress: otherStealth.stealthAddress,
        caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        ephemeralPubKey: bytesToHex(otherStealth.ephemeralPubKey),
        metadata: otherStealth.viewTag.toString(16).padStart(2, '0'),
      },
    ];

    const matched = await scanAnnouncements(
      announcements,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingScalar,
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].stealthAddress).toBe(stealth.stealthAddress);
  });
});
