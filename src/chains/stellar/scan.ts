import { ed25519 } from '@noble/curves/ed25519';
import type { ExtPointType } from '@noble/curves/abstract/edwards';
import { computeAnnouncementViewTag, computeSharedSecret, computeViewTag } from './stealth';
import { hashToScalar, deriveStealthPubKey, pubKeyToStellarAddress, L } from './scalar';
import { SCHEME_ID, SCHEME_ID_V2 } from './constants';
import type { Announcement, MatchedAnnouncement } from './types';
import { encodeStealthMetaAddress, decodeStealthMetaAddress } from './meta-address';
import { hexToBytes } from './utils';
import type { ChainScannerAdapter } from '../../scanner/unified';
import { pipeline } from './scanner/pipeline';
import { getTracer, type Tracer } from '../../telemetry';

/**
 * Progress snapshot emitted during a cold scan so UIs can render honest
 * progress bars instead of guessing at a spinner.
 */
export interface ScanProgress {
  /** Number of ledgers scanned so far. */
  scannedLedgers: number;
  /** Total ledgers to scan, when known (e.g. a bounded cold scan). */
  totalLedgers?: number;
  /** Number of announcements matched so far. */
  matches: number;
  /** Milliseconds elapsed since the scan started. */
  elapsedMs: number;
}

const HEX_TO_BYTE = (() => {
  const table = new Uint8Array(256).fill(255);
  const lower = '0123456789abcdef';
  const upper = '0123456789ABCDEF';
  for (let i = 0; i < 16; i++) {
    table[lower.charCodeAt(i)] = i;
    table[upper.charCodeAt(i)] = i;
  }
  return table;
})();

function readViewTag(metadata: string): number | null {
  const clean = metadata.startsWith('0x') ? metadata.slice(2) : metadata;
  if (clean.length < 2) return null;

  const hi = HEX_TO_BYTE[clean.charCodeAt(0)];
  const lo = HEX_TO_BYTE[clean.charCodeAt(1)];
  if (hi === 255 || lo === 255) return null;

  return (hi << 4) | lo;
}

function decodeHexToBuffer(hex: string, output: Uint8Array): Uint8Array | null {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if ((clean.length & 1) !== 0) return null;

  const byteCount = clean.length / 2;
  if (byteCount > output.length) return null;

  let outOffset = 0;
  for (let i = 0; i < clean.length; i += 2) {
    const hi = HEX_TO_BYTE[clean.charCodeAt(i)];
    const lo = HEX_TO_BYTE[clean.charCodeAt(i + 1)];
    if (hi === 255 || lo === 255) return null;
    output[outOffset++] = (hi << 4) | lo;
  }

  return output.subarray(0, outOffset);
}

/**
 * Streaming announcement scanner. Pipelines `source` through a bounded queue
 * of size `opts.window` (default 64) so fetching stays ahead of decryption,
 * and yields matches as soon as they're found.
 *
 * Uses the cheap public view-tag prefilter before the X25519 shared secret:
 *   1. Derive the viewing public key once from the viewing seed
 *   2. View tag quick filter from R_ephemeral || viewing_pubkey
 *   3. Compute shared secret: S = ECDH(viewing_key, R_ephemeral) only for tag hits
 *   4. Compute hash_scalar = SHA-256("wraith:scalar:" || S) mod L
 *   5. Expected stealth pubkey = K_spend + hash_scalar * G
 *   6. Compare with announced stealth address
 *
 * Unlike fetching all announcements up front and then scanning them, `source` is
 * pulled continuously in the background (see {@link pipeline}) while each buffered
 * announcement is scanned, so RPC round-trips for later pages overlap with the CPU
 * cost of scanning earlier ones instead of running strictly one after the other.
 * Peak memory is still O(window) — the queue never buffers more than `window`
 * announcements ahead of the scan, so a fast source paired with a slow scan
 * doesn't grow memory unbounded.
 *
 * Cancellation is clean: breaking out of the `for-await` loop triggers the `finally`
 * block which stops the pipeline, which in turn calls `.return()` on the source
 * iterator, stopping upstream I/O.
 *
 * @param source  Async iterable of announcements (e.g. from {@link fetchAnnouncementsStream}).
 * @param opts.window  Max announcements buffered ahead of the scan. Smaller = less memory,
 *                     larger = more overlap between fetching and scanning. Default: 64.
 */
export async function* scanAnnouncementsStream(
  source: AsyncIterable<Announcement>,
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  spendingScalar: bigint,
  opts: { window?: number; tracer?: Tracer } = {},
): AsyncGenerator<MatchedAnnouncement> {
  const windowSize = Math.max(1, opts.window ?? 64);
  const viewingPubKey = ed25519.getPublicKey(viewingKey);
  const piped = pipeline(source, windowSize);

  const span = (opts.tracer ?? getTracer()).startSpan('stellar.scan', {
    'wraith.chain': 'stellar',
    'wraith.scan.window': windowSize,
  });
  let scanned = 0;
  let matched = 0;

  try {
    for await (const ann of piped) {
      scanned++;
      if (ann.schemeId !== SCHEME_ID && ann.schemeId !== SCHEME_ID_V2) continue;

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
        matched++;
        const matchedAnnouncement = decryptMatch(
          ann,
          result.hashScalar,
          result.stealthPubKeyBytes,
          spendingScalar,
          opts.tracer,
        );
        yield matchedAnnouncement;
      }
    }
    span.setAttribute('wraith.scan.scanned_count', scanned);
    span.setAttribute('wraith.scan.matched_count', matched);
  } catch (err) {
    span.recordException(err);
    throw err;
  } finally {
    // Signal the pipeline (and transitively the source) to stop when consumer cancels early
    await piped.return(undefined);
    span.end();
  }
}

/**
 * Derives the spendable private scalar for one matched announcement.
 *
 * Split out of {@link scanAnnouncementsStream} so this (comparatively rare)
 * "decrypt" step gets its own span, separate from the continuous per-candidate
 * scan loop.
 */
function decryptMatch(
  ann: Announcement,
  hashScalar: bigint,
  stealthPubKeyBytes: Uint8Array,
  spendingScalar: bigint,
  tracer: Tracer | undefined,
): MatchedAnnouncement {
  const span = (tracer ?? getTracer()).startSpan('stellar.scan.match', {
    'wraith.chain': 'stellar',
    'wraith.scan.scheme_id': ann.schemeId,
  });
  try {
    const stealthPrivateScalar = ((spendingScalar % L) + hashScalar) % L;
    return {
      ...ann,
      stealthPrivateScalar,
      stealthPubKeyBytes,
    };
  } catch (err) {
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}

/**
 * Pre-pipelining scanner retained for benchmarks.
 *
 * Matches the old streaming scan path: it prefetches up to `window` announcements
 * strictly before scanning any of them, so no RPC fetch for the next window can
 * start until the current window is fully scanned. {@link scanAnnouncementsStream}
 * replaced this with a pipelined version that overlaps fetching with scanning.
 *
 * @see {@link scanAnnouncementsStream}
 */
export async function* scanAnnouncementsStreamSequential(
  source: AsyncIterable<Announcement>,
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  spendingScalar: bigint,
  opts: { window?: number } = {},
): AsyncGenerator<MatchedAnnouncement> {
  const windowSize = Math.max(1, opts.window ?? 64);
  const viewingPubKey = ed25519.getPublicKey(viewingKey);
  const iter = source[Symbol.asyncIterator]();
  const ephemeralBuffer = new Uint8Array(32);
  let spendingPoint: ExtPointType | undefined;

  try {
    try {
      spendingPoint = ed25519.ExtendedPoint.fromHex(spendingPubKey);
    } catch {
      spendingPoint = undefined;
    }

    while (true) {
      const batch: Announcement[] = [];
      for (let i = 0; i < windowSize; i++) {
        const next = await iter.next();
        if (next.done) break;
        batch.push(next.value);
      }

      if (batch.length === 0) break;

      for (const ann of batch) {
        if (ann.schemeId !== SCHEME_ID && ann.schemeId !== SCHEME_ID_V2) continue;

        const viewTag = readViewTag(ann.metadata);
        if (viewTag === null) continue;

        const ephPubKey = decodeHexToBuffer(ann.ephemeralPubKey, ephemeralBuffer);
        if (!ephPubKey || ephPubKey.length !== 32 || !spendingPoint) continue;

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
          const stealthPrivateScalar = ((spendingScalar % L) + result.hashScalar) % L;
          yield {
            ...ann,
            stealthPrivateScalar,
            stealthPubKeyBytes: result.stealthPubKeyBytes,
          };
        }
      }

      if (batch.length < windowSize) break;
    }
  } finally {
    await iter.return?.();
  }
}

/**
 * Checks whether one Stellar announcement can belong to a recipient.
 *
 * This is view-only detection. It uses the viewing key and spending public key
 * to reconstruct the expected stealth account, but it cannot derive the private
 * scalar needed to spend.
 *
 * @param ephemeralPubKey - 32-byte ephemeral public key from the announcement.
 * @param viewingKey - Recipient's 32-byte viewing seed.
 * @param spendingPubKey - Recipient's 32-byte spending public key.
 * @param viewTag - One-byte view tag from announcement metadata.
 * @returns Match status plus the derived address and scalar details when matched.
 * @throws {Error} If the ephemeral or spending public key is not a valid ed25519 point.
 *
 * @example
 * ```ts
 * import { checkStealthAddress, hexToBytes } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const result = checkStealthAddress(
 *   hexToBytes(announcement.ephemeralPubKey),
 *   keys.viewingKey,
 *   keys.spendingPubKey,
 *   hexToBytes(announcement.metadata)[0],
 * );
 * ```
 *
 * @see {@link scanAnnouncements}
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
  const spendingPoint = ed25519.ExtendedPoint.fromHex(spendingPubKey);
  return checkStealthAddressWithViewingPubKey(
    ephemeralPubKey,
    viewingKey,
    viewingPubKey,
    spendingPubKey,
    viewTag,
    spendingPoint,
  );
}

function checkStealthAddressWithViewingPubKey(
  ephemeralPubKey: Uint8Array,
  viewingKey: Uint8Array,
  viewingPubKey: Uint8Array,
  spendingPubKey: Uint8Array,
  viewTag: number,
  spendingPoint?: ExtPointType,
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
    return deriveStealthAddressFromAnnouncement(
      ephemeralPubKey,
      viewingKey,
      spendingPubKey,
      spendingPoint,
    );
  } catch {
    return { isMatch: false, stealthAddress: null, hashScalar: null, stealthPubKeyBytes: null };
  }
}

function deriveStealthAddressFromAnnouncement(
  ephemeralPubKey: Uint8Array,
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  spendingPoint?: ExtPointType,
): {
  isMatch: boolean;
  stealthAddress: string | null;
  hashScalar: bigint | null;
  stealthPubKeyBytes: Uint8Array | null;
} {
  const sharedSecret = computeSharedSecret(viewingKey, ephemeralPubKey);
  const hScalar = hashToScalar(sharedSecret);

  const stealthPubKeyBytes = deriveStealthPubKey(spendingPubKey, hScalar, spendingPoint);
  const stealthAddress = pubKeyToStellarAddress(stealthPubKeyBytes);

  return { isMatch: true, stealthAddress, hashScalar: hScalar, stealthPubKeyBytes };
}

/**
 * Scans Stellar stealth announcements and returns the ones a recipient can spend.
 *
 * @deprecated Prefer {@link scanAnnouncementsStream} for memory-efficient streaming.
 * For large announcement sets this loads the full array into memory, which can
 * exhaust TEE memory budgets. This function is kept for backward compatibility.
 *
 * Use this after fetching Soroban announcements. The spending scalar is required
 * because matched results include the derived stealth private scalar for later
 * transaction signing.
 *
 * @param announcements - Candidate announcements from Soroban events.
 * @param viewingKey - Recipient's 32-byte viewing seed.
 * @param spendingPubKey - Recipient's 32-byte spending public key.
 * @param spendingScalar - Recipient's private spending scalar.
 * @returns Announcements that match the recipient, each with spendable scalar data.
 * @throws {Error} If a matching announcement contains malformed public-key data.
 *
 * @example
 * ```ts
 * import { fetchAnnouncements, scanAnnouncements } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const announcements = await fetchAnnouncements("stellar");
 * const matches = scanAnnouncements(
 *   announcements,
 *   keys.viewingKey,
 *   keys.spendingPubKey,
 *   keys.spendingScalar,
 * );
 * ```
 *
 * @see {@link deriveStealthPrivateScalar}
 */
export function scanAnnouncements(
  announcements: Announcement[],
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  spendingScalar: bigint,
): MatchedAnnouncement[] {
  const matched: MatchedAnnouncement[] = [];
  const viewingPubKey = ed25519.getPublicKey(viewingKey);
  const ephemeralBuffer = new Uint8Array(32);
  let spendingPoint: ExtPointType | undefined;

  try {
    spendingPoint = ed25519.ExtendedPoint.fromHex(spendingPubKey);
  } catch {
    spendingPoint = undefined;
  }

  for (let i = 0, len = announcements.length; i < len; i++) {
    const ann = announcements[i];
    if (ann.schemeId !== SCHEME_ID && ann.schemeId !== SCHEME_ID_V2) continue;

    const viewTag = readViewTag(ann.metadata);
    if (viewTag === null) continue;

    const ephPubKey = decodeHexToBuffer(ann.ephemeralPubKey, ephemeralBuffer);
    if (!ephPubKey || ephPubKey.length !== 32 || !spendingPoint) continue;

    const result = checkStealthAddressWithViewingPubKey(
      ephPubKey,
      viewingKey,
      viewingPubKey,
      spendingPubKey,
      viewTag,
      spendingPoint,
    );

    if (
      result.isMatch &&
      result.stealthAddress === ann.stealthAddress &&
      result.hashScalar !== null &&
      result.stealthPubKeyBytes !== null
    ) {
      const stealthPrivateScalar = ((spendingScalar % L) + result.hashScalar) % L;
      if (stealthPrivateScalar <= 0n) continue;

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
      const stealthPrivateScalar = ((spendingScalar % L) + hScalar) % L;
      if (stealthPrivateScalar <= 0n) continue;

      matched.push({
        ...ann,
        stealthPrivateScalar,
        stealthPubKeyBytes,
      });
    }
  }

  return matched;
}

/**
 * Stellar ChainScannerAdapter implementation.
 */
export const adapter: ChainScannerAdapter<
  Announcement,
  { viewingKey: Uint8Array; spendingPubKey: Uint8Array; spendingScalar: bigint },
  MatchedAnnouncement
> = {
  id: 'stellar',
  scan: async function* (source, keys) {
    yield* scanAnnouncementsStream(
      source,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingScalar,
    );
  },
  decodeMetaAddress: decodeStealthMetaAddress,
  encodeMetaAddress: encodeStealthMetaAddress,
};

export const stellarAdapter = adapter;
