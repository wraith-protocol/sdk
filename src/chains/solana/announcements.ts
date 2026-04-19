import type { Announcement } from './types';
import { getDeployment } from './deployments';
import { bytesToHex } from './utils';

/**
 * Anchor event discriminator for AnnouncementEvent.
 * First 8 bytes of SHA-256("event:AnnouncementEvent").
 */
const ANNOUNCEMENT_EVENT_DISCRIMINATOR = [0xfa, 0xb0, 0x2a, 0xef, 0x3c, 0xad, 0x36, 0x88];

/**
 * Fetches stealth address announcements from both the announcer and sender programs.
 * Queries each program's transaction history and parses AnnouncementEvent logs.
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

  const programIds = [deployment.contracts.announcer, deployment.contracts.sender];

  const all: Announcement[] = [];

  for (const id of programIds) {
    const programId = new PublicKey(id);
    const signatures = await connection.getSignaturesForAddress(programId, { limit: 1000 });

    for (const sig of signatures) {
      try {
        const tx = await connection.getTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });
        if (!tx?.meta?.logMessages) continue;

        const parsed = parseAnnouncementFromLogs(tx.meta.logMessages, PublicKey);
        if (parsed) all.push(parsed);
      } catch {
        continue;
      }
    }
  }

  return all;
}

function parseAnnouncementFromLogs(
  logs: string[],
  PublicKey: typeof import('@solana/web3.js').PublicKey,
): Announcement | null {
  try {
    for (const log of logs) {
      if (!log.startsWith('Program data: ')) continue;

      const base64Data = log.replace('Program data: ', '');
      const buffer = Buffer.from(base64Data, 'base64');

      // Check Anchor event discriminator (first 8 bytes)
      if (buffer.length < 8) continue;
      const discriminator = Array.from(buffer.slice(0, 8));
      const matches = ANNOUNCEMENT_EVENT_DISCRIMINATOR.every((b, i) => b === discriminator[i]);
      if (!matches) continue;

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
