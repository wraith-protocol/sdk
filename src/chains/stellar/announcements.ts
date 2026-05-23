import type { Announcement } from './types';
import { bytesToHex } from './utils';
import { getDeployment } from './deployments';

/**
 * Fetches Stellar stealth announcements from the configured Soroban RPC.
 *
 * Use this before {@link scanAnnouncements} when a recipient wants to discover
 * incoming payments. The helper queries the configured announcer contract with
 * `getEvents`, handles pagination, and parses event XDR into SDK announcement
 * objects.
 *
 * @param chain - Deployment key from {@link DEPLOYMENTS}; defaults to `stellar`.
 * @param sorobanUrl - Optional Soroban RPC URL override.
 * @returns Parsed announcements from the selected announcer contract.
 * @throws {Error} If the deployment key is unknown or the RPC request fails before returning JSON.
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
 * @see {@link getDeployment}
 */
export async function fetchAnnouncements(
  chain: string = 'stellar',
  sorobanUrl?: string,
): Promise<Announcement[]> {
  const deployment = getDeployment(chain);
  const url = sorobanUrl || deployment.sorobanUrl;
  const announcerContract = deployment.contracts.announcer;
  const all: Announcement[] = [];

  let startLedger = 1;

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
  if (probeData.error?.message) {
    const match = probeData.error.message.match(/range:\s*(\d+)\s*-\s*(\d+)/);
    if (match) {
      const oldest = parseInt(match[1], 10);
      const latest = parseInt(match[2], 10);
      startLedger = Math.max(oldest, latest - 5000);
    } else {
      return all;
    }
  }

  let cursor: string | undefined;
  let hasMore = true;

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
    const events = data.result?.events ?? [];

    for (const event of events) {
      const ann = parseAnnouncementEvent(event);
      if (ann) all.push(ann);
    }

    if (events.length < 1000) {
      hasMore = false;
    } else {
      cursor = data.result?.cursor;
      if (!cursor) hasMore = false;
    }
  }

  return all;
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

    return {
      schemeId: schemeIdScVal.u32(),
      stealthAddress,
      caller,
      ephemeralPubKey: bytesToHex(new Uint8Array(ephPubKeyBytes)),
      metadata: bytesToHex(new Uint8Array(viewTagBytes)),
    };
  } catch {
    return null;
  }
}
