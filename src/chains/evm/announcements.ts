import type { Announcement } from './types';
import { SCHEME_ID } from './constants';
import { getDeployment } from './deployments';
import { parseSubgraphAnnouncementsPage } from './validation';
import { readBoundedJson, type RPCResponseContext } from '../rpcValidation';

/**
 * Fetches all stealth address announcements from the Goldsky subgraph
 * for the specified EVM chain.
 *
 * Each page is size-bounded and its records are validated before they are
 * returned, so a malformed or hostile subgraph response cannot reach address
 * matching or key derivation.
 *
 * @param chain The chain identifier (e.g., "horizen").
 * @param subgraphUrl Optional override for the subgraph URL.
 * @returns Array of announcements.
 * @throws {RPCRequestError} If the subgraph returns a non-2xx status.
 * @throws {RPCResponseError} If a page is oversized, malformed, or contains an
 *   invalid announcement record.
 */
export async function fetchAnnouncements(
  chain: string,
  subgraphUrl?: string,
): Promise<Announcement[]> {
  const url = subgraphUrl || getDeployment(chain).subgraphUrl;
  const context: RPCResponseContext = { chain, operation: 'fetchAnnouncements' };
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

    const payload = await readBoundedJson(res, context, url);
    const { announcements, recordCount } = parseSubgraphAnnouncementsPage(payload, context);
    all.push(...announcements);

    if (recordCount < batchSize) {
      hasMore = false;
    } else {
      skip += batchSize;
    }
  }

  return all;
}
