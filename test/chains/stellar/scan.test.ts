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
import { generateStealthAddress } from '../../../src/chains/stellar/stealth';
import {
  checkStealthAddress,
  scanAnnouncements,
  scanAnnouncementsStream,
} from '../../../src/chains/stellar/scan';
import { SCHEME_ID } from '../../../src/chains/stellar/constants';
import { bytesToHex } from '../../../src/chains/stellar/utils';
import type { Announcement, MatchedAnnouncement } from '../../../src/chains/stellar/types';

const testSig = new Uint8Array(64).fill(0xaa);

async function* announcementsFrom(items: Announcement[]): AsyncGenerator<Announcement> {
  for (const item of items) yield item;
}

async function collectStream(
  stream: AsyncGenerator<MatchedAnnouncement>,
): Promise<MatchedAnnouncement[]> {
  const results: MatchedAnnouncement[] = [];
  for await (const item of stream) results.push(item);
  return results;
}

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
        caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
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

  test('accepts v2 scheme ID announcements', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    const announcements: Announcement[] = [
      {
        schemeId: 2,
        stealthAddress: stealth.stealthAddress,
        caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
        metadata: stealth.viewTag.toString(16).padStart(2, '0'),
        viewTagBucket: stealth.viewTag,
      },
    ];

    const matched = scanAnnouncements(
      announcements,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingScalar,
    );
    expect(matched).toHaveLength(1);
  });

  test('skips wrong scheme ID', () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    const announcements: Announcement[] = [
      {
        schemeId: 99,
        stealthAddress: stealth.stealthAddress,
        caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
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

  test('skips invalid ephemeral keys even when the public view tag matches', () => {
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

    const matched = scanAnnouncements(
      announcements,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingScalar,
    );

    expect(matched).toHaveLength(0);
  });

  test('keeps legacy shared-secret view tags on the legacy scanner path', () => {
    const keys = deriveStealthKeys(testSig);
    let ephemeralSeed = new Uint8Array(32).fill(0x11);
    let stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, ephemeralSeed);
    let sharedSecret = computeSharedSecret(ephemeralSeed, keys.viewingPubKey);
    let legacyTag = computeViewTag(sharedSecret);

    // Use a deterministic seed whose legacy shared-secret tag differs from the
    // optimized public-announcement tag so the migration boundary is explicit.
    for (let i = 0; legacyTag === stealth.viewTag && i < 255; i++) {
      ephemeralSeed = new Uint8Array(32).fill(0x12 + i);
      stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, ephemeralSeed);
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
      scanAnnouncements(announcements, keys.viewingKey, keys.spendingPubKey, keys.spendingScalar),
    ).toHaveLength(0);

    const legacyMatched = scanAnnouncementsLegacySharedSecretTag(
      announcements,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingScalar,
    );

    expect(legacyMatched).toHaveLength(1);
    expect(legacyMatched[0].stealthAddress).toBe(stealth.stealthAddress);
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

describe('scanAnnouncementsStream', () => {
  test('finds matching payment', async () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    const announcements: Announcement[] = [
      {
        schemeId: SCHEME_ID,
        stealthAddress: stealth.stealthAddress,
        caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
        metadata: stealth.viewTag.toString(16).padStart(2, '0'),
      },
    ];

    const matched = await collectStream(
      scanAnnouncementsStream(
        announcementsFrom(announcements),
        keys.viewingKey,
        keys.spendingPubKey,
        keys.spendingScalar,
      ),
    );

    expect(matched).toHaveLength(1);
    expect(matched[0].stealthAddress).toBe(stealth.stealthAddress);
    expect(typeof matched[0].stealthPrivateScalar).toBe('bigint');
    expect(matched[0].stealthPubKeyBytes).toBeInstanceOf(Uint8Array);
  });

  test('skips wrong scheme ID', async () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    const announcements: Announcement[] = [
      {
        schemeId: 99,
        stealthAddress: stealth.stealthAddress,
        caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
        metadata: stealth.viewTag.toString(16).padStart(2, '0'),
      },
    ];

    const matched = await collectStream(
      scanAnnouncementsStream(
        announcementsFrom(announcements),
        keys.viewingKey,
        keys.spendingPubKey,
        keys.spendingScalar,
      ),
    );

    expect(matched).toHaveLength(0);
  });

  test('filters mix of own and foreign announcements', async () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    const otherSig = new Uint8Array(64).fill(0xbb);
    const otherKeys = deriveStealthKeys(otherSig);
    const otherStealth = generateStealthAddress(otherKeys.spendingPubKey, otherKeys.viewingPubKey);

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

    const matched = await collectStream(
      scanAnnouncementsStream(
        announcementsFrom(announcements),
        keys.viewingKey,
        keys.spendingPubKey,
        keys.spendingScalar,
      ),
    );

    expect(matched).toHaveLength(1);
    expect(matched[0].stealthAddress).toBe(stealth.stealthAddress);
  });

  test('cancellation: stops cleanly after first match and signals source', async () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    const ann: Announcement = {
      schemeId: SCHEME_ID,
      stealthAddress: stealth.stealthAddress,
      caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
      metadata: stealth.viewTag.toString(16).padStart(2, '0'),
    };

    let sourceStopped = false;
    async function* infiniteAnnouncements(): AsyncGenerator<Announcement> {
      try {
        while (true) yield ann;
      } finally {
        sourceStopped = true;
      }
    }

    const results: MatchedAnnouncement[] = [];
    for await (const match of scanAnnouncementsStream(
      infiniteAnnouncements(),
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingScalar,
    )) {
      results.push(match);
      break;
    }

    expect(results).toHaveLength(1);
    expect(sourceStopped).toBe(true);
  });

  test('custom window: processes all announcements with window=1', async () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    const announcements: Announcement[] = Array.from({ length: 10 }, () => ({
      schemeId: SCHEME_ID,
      stealthAddress: stealth.stealthAddress,
      caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
      metadata: stealth.viewTag.toString(16).padStart(2, '0'),
    }));

    const matched = await collectStream(
      scanAnnouncementsStream(
        announcementsFrom(announcements),
        keys.viewingKey,
        keys.spendingPubKey,
        keys.spendingScalar,
        { window: 1 },
      ),
    );

    expect(matched).toHaveLength(10);
  });

  test('custom window: processes all announcements with window=200', async () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    const announcements: Announcement[] = Array.from({ length: 150 }, () => ({
      schemeId: SCHEME_ID,
      stealthAddress: stealth.stealthAddress,
      caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
      metadata: stealth.viewTag.toString(16).padStart(2, '0'),
    }));

    const matched = await collectStream(
      scanAnnouncementsStream(
        announcementsFrom(announcements),
        keys.viewingKey,
        keys.spendingPubKey,
        keys.spendingScalar,
        { window: 200 },
      ),
    );

    expect(matched).toHaveLength(150);
  });

  test('memory bounded: 100k announcements use < 10x memory of 1k', async () => {
    const keys = deriveStealthKeys(testSig);

    async function* makeStream(count: number): AsyncGenerator<Announcement> {
      for (let i = 0; i < count; i++) {
        yield {
          schemeId: 99,
          stealthAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          ephemeralPubKey: '00'.repeat(32),
          metadata: '00',
        };
      }
    }

    async function measureHeapDelta(count: number): Promise<number> {
      if (typeof (global as { gc?: () => void }).gc === 'function') {
        (global as { gc?: () => void }).gc!();
      }
      const before = process.memoryUsage().heapUsed;
      // window=64 (default) — peak memory O(64) regardless of total count
      for await (const _ of scanAnnouncementsStream(
        makeStream(count),
        keys.viewingKey,
        keys.spendingPubKey,
        keys.spendingScalar,
      )) {
        // no matches expected — schemeId=99 filtered immediately
      }
      if (typeof (global as { gc?: () => void }).gc === 'function') {
        (global as { gc?: () => void }).gc!();
      }
      return Math.max(process.memoryUsage().heapUsed - before, 1);
    }

    const mem1k = await measureHeapDelta(1_000);
    const mem100k = await measureHeapDelta(100_000);

    expect(mem100k).toBeLessThan(Math.max(mem1k * 10, 5 * 1024 * 1024));
  }, 30_000);
});
