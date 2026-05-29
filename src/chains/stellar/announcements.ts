import type { Announcement, Network } from './types';
import type { AnnouncementCache } from './cache';
import { autoSelectCache } from './cache';
import { bytesToHex } from './utils';
import { getDeployment } from './deployments';

/** Module-level default cache instance (auto-selects Memory or IndexedDB). */
let _defaultCache: AnnouncementCache | null = null;
function getDefaultCache(): AnnouncementCache {
  if (!_defaultCache) _defaultCache = autoSelectCache();
  return _defaultCache;
}

export interface FetchAnnouncementsOptions {
  /** Override the Soroban RPC URL. */
  sorobanUrl?: string;
  /**
   * Skip the cache and always fetch from RPC.
   * Use after sending a payment to ensure the new announcement is visible.
   */
  bypassCache?: boolean;
  /** Provide a custom cache implementation (e.g., for testing). */
  cache?: AnnouncementCache;
}

/**
 * Fetches stealth address announcements from the Soroban RPC for the given
 * Stellar network, using an announcement cache to avoid redundant RPC traffic.
 *
 * On the first call the full available window is fetched. On subsequent calls
 * only the delta since the last seen ledger is fetched, and results are merged
 * with cached data before being returned.
 *
 * @param chain The chain identifier (default: `"stellar"`).
 * @param options Fetch options including cache bypass and custom cache.
 * @returns Array of all known announcements (cached + fresh).
 */
export async function fetchAnnouncements(
  chain: string = 'stellar',
  options: FetchAnnouncementsOptions = {},
): Promise<Announcement[]> {
  const { sorobanUrl, bypassCache = false, cache = getDefaultCache() } = options;

  const deployment = getDeployment(chain);
  const url = sorobanUrl || deployment.sorobanUrl;
  const announcerContract = deployment.contracts.announcer;
  const network = (chain === 'stellar' ? 'mainnet' : chain) as Network;

  // ------------------------------------------------------------------
  // Resolve window boundaries via a probe request
  // ------------------------------------------------------------------
  const probeRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'getEvents',
      params: {
        startLedger: 1,
        filters: [{ type: 'contract', contractIds: [announcerContract] }],
        pagination: { limit: 1 },
      },
    }),
  });

  const probeData = await probeRes.json();
  let windowStart = 1;
  let windowEnd = Number.MAX_SAFE_INTEGER;

  if (probeData.error?.message) {
    const match = probeData.error.message.match(/range:\s*(\d+)\s*-\s*(\d+)/);
    if (match) {
      const oldest = parseInt(match[1], 10);
      const latest = parseInt(match[2], 10);
      windowStart = Math.max(oldest, latest - 5000);
      windowEnd = latest;
    } else {
      return [];
    }
  }

  // ------------------------------------------------------------------
  // Cache integration
  // ------------------------------------------------------------------
  let fetchFromLedger = windowStart;
  let resumeCursor: string | undefined;
  let cached: Announcement[] = [];

  if (!bypassCache) {
    const lastSeen = await cache.getLastSeen(network);
    if (lastSeen) {
      // Only fetch the delta.
      fetchFromLedger = lastSeen.ledger + 1;
      resumeCursor = lastSeen.cursor;
      const hit = await cache.get(network, windowStart, lastSeen.ledger);
      cached = hit ?? [];
    }
  }

  // Nothing new to fetch.
  if (fetchFromLedger > windowEnd) return cached;

  // ------------------------------------------------------------------
  // Fetch delta from RPC
  // ------------------------------------------------------------------
  const { announcements: fresh, lastLedger, lastCursor } = await fetchRange(
    url,
    announcerContract,
    fetchFromLedger,
    resumeCursor,
  );

  if (!bypassCache && fresh.length > 0 && lastLedger !== undefined && lastCursor) {
    await cache.put(network, fresh);
    await cache.setLastSeen(network, lastLedger, lastCursor);
  }

  return [...cached, ...fresh];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface FetchRangeResult {
  announcements: Announcement[];
  lastLedger: number | undefined;
  lastCursor: string | undefined;
}

async function fetchRange(
  url: string,
  announcerContract: string,
  startLedger: number,
  resumeCursor?: string,
): Promise<FetchRangeResult> {
  const all: Announcement[] = [];
  let cursor = resumeCursor;
  let hasMore = true;
  let lastLedger: number | undefined;
  let lastCursor: string | undefined;

  while (hasMore) {
    const params: Record<string, unknown> = {
      filters: [{ type: 'contract', contractIds: [announcerContract] }],
      pagination: { limit: 1000 },
    };

    if (cursor) {
      params.pagination = { limit: 1000, cursor };
    } else {
      params.startLedger = startLedger;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'getEvents', params }),
    });

    const data = await res.json();
    const events: Record<string, unknown>[] = data.result?.events ?? [];

    for (const event of events) {
      const ann = parseAnnouncementEvent(event);
      if (ann) {
        all.push(ann);
        if (ann.ledger !== undefined && (lastLedger === undefined || ann.ledger > lastLedger)) {
          lastLedger = ann.ledger;
        }
      }
    }

    if (events.length < 1000) {
      hasMore = false;
    } else {
      cursor = data.result?.cursor as string | undefined;
      if (!cursor) hasMore = false;
      else lastCursor = cursor;
    }
  }

  return { announcements: all, lastLedger, lastCursor };
}

function parseAnnouncementEvent(event: Record<string, unknown>): Announcement | null {
  try {
    const { xdr, Address } = require('@stellar/stellar-sdk');

    const topics = event.topic as string[];
    if (!topics || topics.length < 3) return null;

    const schemeIdScVal = xdr.ScVal.fromXDR(topics[1], 'base64');
    const stealthScVal = xdr.ScVal.fromXDR(topics[2], 'base64');
    const stealthAddress = Address.fromScAddress(stealthScVal.address()).toString();

    const valueScVal = xdr.ScVal.fromXDR(event.value as string, 'base64');
    const valueVec = valueScVal.vec();
    if (!valueVec || valueVec.length < 3) return null;

    const caller = Address.fromScAddress(valueVec[0].address()).toString();
    const ephPubKeyBytes = valueVec[1].bytes();
    const viewTagBytes = valueVec[2].bytes();
    if (!ephPubKeyBytes || !viewTagBytes) return null;

    const ledger = typeof event.ledger === 'number' ? event.ledger : typeof event.ledger === 'string' ? parseInt(event.ledger, 10) : undefined;

    return {
      schemeId: schemeIdScVal.u32(),
      stealthAddress,
      caller,
      ephemeralPubKey: bytesToHex(new Uint8Array(ephPubKeyBytes)),
      metadata: bytesToHex(new Uint8Array(viewTagBytes)),
      ledger,
    };
  } catch {
    return null;
  }
}
