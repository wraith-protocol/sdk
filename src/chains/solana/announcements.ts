import type { Announcement } from './types';
import { getDeployment } from './deployments';
import { bytesToHex } from './utils';

/**
 * Fetches stealth address announcements from the Solana announcer program.
 * Queries the program's transaction history and parses AnnouncementEvent logs.
 *
 * Requires @solana/web3.js as a peer dependency.
 *
 * @param chain The chain identifier (default: "solana").
 * @param rpcUrl Optional override for the RPC URL.
 */
export async function fetchAnnouncements(
  chain: string = 'solana',
  rpcUrl?: string,
): Promise<Announcement[]> {
  const deployment = getDeployment(chain);
  const url = rpcUrl || deployment.rpcUrl;

  const { Connection, PublicKey } = await import('@solana/web3.js');
  const connection = new Connection(url);
  const programId = new PublicKey(deployment.contracts.announcer);

  const all: Announcement[] = [];

  const signatures = await connection.getSignaturesForAddress(programId, { limit: 1000 });

  for (const sig of signatures) {
    try {
      const tx = await connection.getTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (!tx?.meta?.logMessages) continue;

      const parsed = parseAnnouncementFromLogs(tx.meta.logMessages);
      if (parsed) all.push(parsed);
    } catch {
      continue;
    }
  }

  return all;
}

function parseAnnouncementFromLogs(logs: string[]): Announcement | null {
  try {
    for (const log of logs) {
      if (!log.includes('AnnouncementEvent')) continue;

      const dataLog = logs.find((l) => l.startsWith('Program data: '));
      if (!dataLog) return null;

      const base64Data = dataLog.replace('Program data: ', '');
      const buffer = Buffer.from(base64Data, 'base64');

      // Anchor event discriminator is first 8 bytes, skip it
      let offset = 8;

      const schemeId = buffer.readUInt32LE(offset);
      offset += 4;

      const stealthAddress = buffer.slice(offset, offset + 32);
      offset += 32;

      const caller = buffer.slice(offset, offset + 32);
      offset += 32;

      const ephemeralPubKey = buffer.slice(offset, offset + 32);
      offset += 32;

      const metadataLen = buffer.readUInt32LE(offset);
      offset += 4;
      const metadata = buffer.slice(offset, offset + metadataLen);

      const { PublicKey } = require('@solana/web3.js');

      return {
        schemeId,
        stealthAddress: new PublicKey(stealthAddress).toBase58(),
        caller: new PublicKey(caller).toBase58(),
        ephemeralPubKey: bytesToHex(new Uint8Array(ephemeralPubKey)),
        metadata: bytesToHex(new Uint8Array(metadata)),
      };
    }
    return null;
  } catch {
    return null;
  }
}
