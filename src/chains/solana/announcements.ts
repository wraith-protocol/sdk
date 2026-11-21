import type { Announcement } from './types';
import { getDeployment } from './deployments';
import {
  createBoundedSolanaFetch,
  parseAnnouncementLogs,
  parseSignaturePage,
  parseTransactionLogs,
} from './validation';
import { RPCResponseError } from '../../errors';
import type { RPCResponseContext } from '../rpcValidation';

/**
 * Fetches stealth address announcements from both the announcer and sender programs.
 * Queries each program's transaction history and parses AnnouncementEvent logs.
 *
 * Responses are size-bounded, and signature pages, transaction metadata and
 * announcement logs are validated before decoding, so a malformed response
 * cannot reach key derivation.
 *
 * Requires @solana/web3.js as a peer dependency.
 *
 * @param chain The chain identifier (default: "solana").
 * @param rpcUrl Optional override for the RPC URL.
 * @throws {RPCResponseError} If a signature page, transaction or announcement
 *   log payload is malformed, truncated or oversized.
 */
export async function fetchAnnouncements(
  chain: string = 'solana',
  rpcUrl?: string,
): Promise<Announcement[]> {
  const deployment = getDeployment(chain);
  const url = rpcUrl || deployment.rpcUrl;
  const context: RPCResponseContext = { chain, operation: 'fetchAnnouncements' };

  const { Connection, PublicKey } = await import('@solana/web3.js');
  const connection = new Connection(url, { fetch: createBoundedSolanaFetch(context) });

  const programIds = [deployment.contracts.announcer, deployment.contracts.sender];

  const all: Announcement[] = [];

  for (const id of programIds) {
    const programId = new PublicKey(id);
    const signatures = parseSignaturePage(
      await connection.getSignaturesForAddress(programId, { limit: 1000 }),
      context,
    );

    for (const signature of signatures) {
      try {
        const tx = await connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0,
        });
        const logs = parseTransactionLogs(tx, context);
        if (!logs) continue;

        all.push(...parseAnnouncementLogs(logs, context, 'result.meta.logMessages'));
      } catch (err) {
        // A single unavailable transaction should not abort the scan, but a
        // schema violation must surface instead of being silently skipped.
        if (err instanceof RPCResponseError) throw err;
        continue;
      }
    }
  }

  return all;
}
