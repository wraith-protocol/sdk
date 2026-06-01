import { ed25519 } from '@noble/curves/ed25519';
import { computeAnnouncementViewTag, computeSharedSecret, computeViewTag } from './stealth';
import { hashToScalar, deriveStealthPubKey, pubKeyToStellarAddress, L } from './scalar';
import { SCHEME_ID } from './constants';
import type { Announcement, MatchedAnnouncement } from './types';
import { hexToBytes } from './utils';

/**
 * Checks whether a single announcement belongs to the recipient.
 *
 * Uses the cheap public view-tag prefilter before the X25519 shared secret:
 *   1. Derive the viewing public key once from the viewing seed
 *   2. View tag quick filter from R_ephemeral || viewing_pubkey
 *   3. Compute shared secret: S = ECDH(viewing_key, R_ephemeral) only for tag hits
 *   4. Compute hash_scalar = SHA-256("wraith:scalar:" || S) mod L
 *   5. Expected stealth pubkey = K_spend + hash_scalar * G
 *   6. Compare with announced stealth address
 *
 * This is view-only: it can detect payments but NOT derive the spending key.
 */
export function checkStealthAddress(
  ephemeralPubKey: Uint8Array,
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  viewTag: number,
): {
  isMatch: boolean;
  stealthAddress: string | null;
  hashScalar: bigint | null;
  stealthPubKeyBytes: Uint8Array | null;
} {
  const viewingPubKey = ed25519.getPublicKey(viewingKey);
  return checkStealthAddressWithViewingPubKey(
    ephemeralPubKey,
    viewingKey,
    viewingPubKey,
    spendingPubKey,
    viewTag,
  );
}

function checkStealthAddressWithViewingPubKey(
  ephemeralPubKey: Uint8Array,
  viewingKey: Uint8Array,
  viewingPubKey: Uint8Array,
  spendingPubKey: Uint8Array,
  viewTag: number,
): {
  isMatch: boolean;
  stealthAddress: string | null;
  hashScalar: bigint | null;
  stealthPubKeyBytes: Uint8Array | null;
} {
  const computedTag = computeAnnouncementViewTag(ephemeralPubKey, viewingPubKey);
  if (computedTag !== viewTag) {
    return { isMatch: false, stealthAddress: null, hashScalar: null, stealthPubKeyBytes: null };
  }

  try {
    return deriveStealthAddressFromAnnouncement(ephemeralPubKey, viewingKey, spendingPubKey);
  } catch {
    return { isMatch: false, stealthAddress: null, hashScalar: null, stealthPubKeyBytes: null };
  }
}

function deriveStealthAddressFromAnnouncement(
  ephemeralPubKey: Uint8Array,
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
): {
  isMatch: boolean;
  stealthAddress: string | null;
  hashScalar: bigint | null;
  stealthPubKeyBytes: Uint8Array | null;
} {
  const sharedSecret = computeSharedSecret(viewingKey, ephemeralPubKey);
  const hScalar = hashToScalar(sharedSecret);

  const stealthPubKeyBytes = deriveStealthPubKey(spendingPubKey, hScalar);
  const stealthAddress = pubKeyToStellarAddress(stealthPubKeyBytes);

  return { isMatch: true, stealthAddress, hashScalar: hScalar, stealthPubKeyBytes };
}

/**
 * Scans a list of on-chain announcements to find those belonging to the recipient.
 *
 * Requires the spending SCALAR (not just public key) to derive the stealth
 * private scalar for each match. This is the key separation:
 *   - Scanning (detection) needs: viewing_key + spending_pubkey
 *   - Spending needs: spending_scalar
 *
 * The stealth private scalar is: (spending_scalar + hash_scalar) mod L
 * This matches the EVM version: p_stealth = (m + s_h) mod n
 */
export function scanAnnouncements(
  announcements: Announcement[],
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  spendingScalar: bigint,
): MatchedAnnouncement[] {
  const matched: MatchedAnnouncement[] = [];
  const viewingPubKey = ed25519.getPublicKey(viewingKey);

  for (const ann of announcements) {
    if (ann.schemeId !== SCHEME_ID) continue;

    const metadataBytes = hexToBytes(ann.metadata);
    if (metadataBytes.length === 0) continue;
    const viewTag = metadataBytes[0];

    const ephPubKey = hexToBytes(ann.ephemeralPubKey);
    if (ephPubKey.length !== 32) continue;

    const result = checkStealthAddressWithViewingPubKey(
      ephPubKey,
      viewingKey,
      viewingPubKey,
      spendingPubKey,
      viewTag,
    );

    if (
      result.isMatch &&
      result.stealthAddress === ann.stealthAddress &&
      result.hashScalar !== null &&
      result.stealthPubKeyBytes !== null
    ) {
      const stealthPrivateScalar = (spendingScalar + result.hashScalar) % L;

      matched.push({
        ...ann,
        stealthPrivateScalar,
        stealthPubKeyBytes: result.stealthPubKeyBytes,
      });
    }
  }

  return matched;
}

/**
 * Pre-optimization scanner retained for benchmarks and migration analysis.
 *
 * This matches the old Stellar path: every same-scheme announcement pays for
 * X25519 first, computes the legacy shared-secret tag second, and only then
 * compares the announced stealth address.
 */
export function scanAnnouncementsLegacySharedSecretTag(
  announcements: Announcement[],
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  spendingScalar: bigint,
): MatchedAnnouncement[] {
  const matched: MatchedAnnouncement[] = [];

  for (const ann of announcements) {
    if (ann.schemeId !== SCHEME_ID) continue;

    const metadataBytes = hexToBytes(ann.metadata);
    if (metadataBytes.length === 0) continue;
    const viewTag = metadataBytes[0];

    const ephPubKey = hexToBytes(ann.ephemeralPubKey);
    if (ephPubKey.length !== 32) continue;

    let sharedSecret: Uint8Array;
    try {
      sharedSecret = computeSharedSecret(viewingKey, ephPubKey);
    } catch {
      continue;
    }

    const computedTag = computeViewTag(sharedSecret);
    if (computedTag !== viewTag) continue;

    const hScalar = hashToScalar(sharedSecret);
    const stealthPubKeyBytes = deriveStealthPubKey(spendingPubKey, hScalar);
    const stealthAddress = pubKeyToStellarAddress(stealthPubKeyBytes);

    if (stealthAddress === ann.stealthAddress) {
      const stealthPrivateScalar = (spendingScalar + hScalar) % L;

      matched.push({
        ...ann,
        stealthPrivateScalar,
        stealthPubKeyBytes,
      });
    }
  }

  return matched;
}
