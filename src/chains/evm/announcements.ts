import type { Announcement, HexString } from './types';
import { SCHEME_ID } from './constants';
import { getDeployment } from './deployments';

/**
 * Fetches all stealth address announcements from the Goldsky subgraph
 * for the specified EVM chain.
 *
 * @param chain The chain identifier (e.g., "horizen").
 * @param subgraphUrl Optional override for the subgraph URL.
 * @returns Array of announcements.
 */
export async function fetchAnnouncements(
  chain: string,
  subgraphUrl?: string,
): Promise<Announcement[]> {
  const url = subgraphUrl || getDeployment(chain).subgraphUrl;
  const all: Announcement[] = [];
  let skip = 0;
  const batchSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const query = {
      query: `query($first: Int!, $skip: Int!) {
        announcements(first: $first, skip: $skip, where: { schemeId: "${SCHEME_ID}" }, orderBy: block_number, orderDirection: asc) {
          schemeId
          stealthAddress
          caller
          ephemeralPubKey
          metadata
        }
      }`,
      variables: { first: batchSize, skip },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    });

    const data = await res.json();
    const announcements = data?.data?.announcements ?? [];

    for (const ann of announcements) {
      all.push({
        schemeId: BigInt(ann.schemeId),
        stealthAddress: ann.stealthAddress as HexString,
        caller: ann.caller as HexString,
        ephemeralPubKey: ann.ephemeralPubKey as HexString,
        metadata: ann.metadata as HexString,
      });
    }

    if (announcements.length < batchSize) {
      hasMore = false;
    } else {
      skip += batchSize;
    }
  }

  return all;
}
