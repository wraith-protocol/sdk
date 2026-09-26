import {
  scanAnnouncements,
  bytesToHex,
  type Announcement,
  type MatchedAnnouncement,
} from '@wraith-protocol/sdk/chains/stellar';
import { hexToBytes } from './hex';
import type { ConnectedWallet, DetectedPayment } from './types';

/**
 * Turns stored (hex/string) wallet material back into the typed inputs the SDK
 * scan functions expect: raw byte arrays and a bigint scalar.
 */
function walletToScanKeys(wallet: ConnectedWallet) {
  return {
    viewingKey: hexToBytes(wallet.viewingKeyHex),
    spendingPubKey: hexToBytes(wallet.spendingPubKeyHex),
    spendingScalar: BigInt(wallet.spendingScalar),
  };
}

function toDetected(match: MatchedAnnouncement): DetectedPayment {
  return {
    stealthAddress: match.stealthAddress,
    ephemeralPubKey: match.ephemeralPubKey,
    ledger: match.ledger,
    memo: match.memo ? String(match.memo.value) : undefined,
    detectedAt: Date.now(),
  };
}

/**
 * Scan an already-collected batch of announcements. Pure crypto — no network.
 *
 * This is the code path the "fire test event" button and the live scanner both
 * funnel through, so a canned announcement exercises the exact same matching
 * logic as a real one.
 */
export function scanBatch(
  wallet: ConnectedWallet,
  announcements: Announcement[],
): DetectedPayment[] {
  const { viewingKey, spendingPubKey, spendingScalar } = walletToScanKeys(wallet);
  const matches = scanAnnouncements(announcements, viewingKey, spendingPubKey, spendingScalar);
  return matches.map(toDetected);
}

export interface LiveScanResult {
  detected: DetectedPayment[];
  scannedCount: number;
  latestLedger?: number;
}

/**
 * Fetch fresh announcements from the Stellar testnet and scan them.
 *
 * `fetchAnnouncementsStream` + `@stellar/stellar-sdk` are imported dynamically
 * so the heavy XDR codec only loads when a real scan runs — the popup and the
 * test-event path never pay for it.
 *
 * @param fromLedger  Only pull announcements at/after this ledger (forward-only
 *                    scanning between runs). Undefined scans the default window.
 */
export async function liveScan(
  wallet: ConnectedWallet,
  fromLedger?: number,
): Promise<LiveScanResult> {
  const { fetchAnnouncementsStream } = await import('@wraith-protocol/sdk/chains/stellar');
  const { viewingKey, spendingPubKey, spendingScalar } = walletToScanKeys(wallet);

  const announcements: Announcement[] = [];
  let latestLedger = fromLedger;

  const stream = fetchAnnouncementsStream('stellar', fromLedger ? { fromLedger } : undefined);
  for await (const ann of stream) {
    announcements.push(ann);
    if (ann.ledger !== undefined && (latestLedger === undefined || ann.ledger > latestLedger)) {
      latestLedger = ann.ledger;
    }
  }

  const matches = scanAnnouncements(announcements, viewingKey, spendingPubKey, spendingScalar);
  return {
    detected: matches.map(toDetected),
    scannedCount: announcements.length,
    latestLedger,
  };
}

/** Re-export for popup/status display without a second SDK import site. */
export { bytesToHex };
