/**
 * scanAnnouncementsWebGPU — drop-in replacement for scanAnnouncements that
 * attempts to accelerate the view-tag + ECDH prefilter via WebGPU.
 *
 * Falls back transparently to the CPU path when WebGPU is unavailable
 * (Node.js, old browsers, server-side environments).
 *
 * Hot-path split:
 *   GPU:  SHA-256 view-tag check + X25519 ECDH → surviving indices
 *   CPU:  hashToScalar + ed25519 point-add + Stellar address encode (on survivors)
 */

import { ed25519 } from '@noble/curves/ed25519';
import { hexToBytes } from '../utils';
import { computeSharedSecret } from '../stealth';
import { hashToScalar, deriveStealthPubKey, pubKeyToStellarAddress, L } from '../scalar';
import { scanAnnouncements } from '../scan';
import { SCHEME_ID } from '../constants';
import { WebGPUStellarScanner, isWebGPUAvailable } from './scanner';
import type { Announcement, MatchedAnnouncement } from '../types';

export { isWebGPUAvailable } from './scanner';

/**
 * Scans announcements using a WebGPU compute shader for the view-tag + ECDH
 * prefilter, then finalises matches on the CPU.
 *
 * Identical semantics to scanAnnouncements(). Safe to call in any environment.
 *
 * Performance characteristics:
 *   - Node.js / SSR: automatic CPU fallback, same performance as scanAnnouncements
 *   - Browser with WebGPU: GPU batch prefilter then CPU finalisation on ~0.4% survivors
 *   - Cold start cost (first call): 50–500 ms for GPU pipeline creation
 *   - Warm subsequent calls: GPU dispatch + readback ~1–5 ms at 100k announcements
 */
export async function scanAnnouncementsWebGPU(
  announcements: Announcement[],
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  spendingScalar: bigint,
): Promise<MatchedAnnouncement[]> {
  if (!isWebGPUAvailable()) {
    // Fast path: synchronous CPU scan, no async overhead
    return scanAnnouncements(announcements, viewingKey, spendingPubKey, spendingScalar);
  }

  // Derive viewing public key once (matches scanAnnouncements behaviour)
  const viewingPubKey = ed25519.getPublicKey(viewingKey);

  // Filter to valid scheme+format before sending to GPU
  const candidates: Array<{
    ann: Announcement;
    ephPubKey: Uint8Array;
    viewTag: number;
    origIdx: number;
  }> = [];
  for (let i = 0; i < announcements.length; i++) {
    const ann = announcements[i];
    if (ann.schemeId !== SCHEME_ID) continue;
    const metaBytes = hexToBytes(ann.metadata);
    if (metaBytes.length === 0) continue;
    const ephPubKey = hexToBytes(ann.ephemeralPubKey);
    if (ephPubKey.length !== 32) continue;
    candidates.push({ ann, ephPubKey, viewTag: metaBytes[0], origIdx: i });
  }

  if (candidates.length === 0) return [];

  // Try GPU prefilter
  const scanner = await WebGPUStellarScanner.create(viewingKey, viewingPubKey);

  let survivorCandidateIndices: number[];

  if (scanner) {
    const ephPubKeys = candidates.map((c) => c.ephPubKey);
    const viewTags = candidates.map((c) => c.viewTag);

    const result = await scanner.scanViewTags(ephPubKeys, viewTags);
    survivorCandidateIndices = result.passingIndices;
    scanner.destroy();
  } else {
    // GPU unavailable — run CPU view-tag filter
    survivorCandidateIndices = candidates
      .map((_, i) => i)
      .filter((i) => {
        const { ephPubKey, viewTag } = candidates[i];
        const { computeAnnouncementViewTag } = require('../stealth') as typeof import('../stealth');
        return computeAnnouncementViewTag(ephPubKey, viewingPubKey) === viewTag;
      });
  }

  // CPU finalisation: hashToScalar + point-add + address comparison on survivors
  const matched: MatchedAnnouncement[] = [];

  for (const ci of survivorCandidateIndices) {
    const { ann, ephPubKey } = candidates[ci];

    let sharedSecret: Uint8Array;
    try {
      sharedSecret = computeSharedSecret(viewingKey, ephPubKey);
    } catch {
      continue;
    }

    const hScalar = hashToScalar(sharedSecret);
    const stealthPubKeyBytes = deriveStealthPubKey(spendingPubKey, hScalar);
    const stealthAddress = pubKeyToStellarAddress(stealthPubKeyBytes);

    if (stealthAddress !== ann.stealthAddress) continue;

    const stealthPrivateScalar = (spendingScalar + hScalar) % L;
    matched.push({ ...ann, stealthPrivateScalar, stealthPubKeyBytes });
  }

  return matched;
}
