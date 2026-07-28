import {
  generateStealthAddress,
  bytesToHex,
  type Announcement,
} from '@wraith-protocol/sdk/chains/stellar';
import { hexToBytes } from './hex';
import type { ConnectedWallet } from './types';

/**
 * Builds a canned announcement addressed to the connected wallet.
 *
 * This does the *sender* side of the protocol locally: it generates a one-time
 * stealth address against the wallet's own spend/view public keys and packs the
 * result into the same `Announcement` shape the RPC path yields. Feeding it back
 * through `scanAnnouncements` therefore produces a real, verifiable match — the
 * notification is not faked, it fires because the scanner genuinely detected a
 * payment it can spend.
 *
 * Used by the "Fire test event" button and to satisfy the acceptance criterion
 * "notification fires on canned test event" with no network access.
 */
export function buildTestAnnouncement(wallet: ConnectedWallet): Announcement {
  const spendingPubKey = hexToBytes(wallet.spendingPubKeyHex);
  const viewingPubKey = hexToBytes(wallet.viewingPubKeyHex);

  const { stealthAddress, ephemeralPubKey, viewTag } = generateStealthAddress(
    spendingPubKey,
    viewingPubKey,
  );

  // Metadata layout: first byte is the view tag (see SDK stellar/scan.ts).
  const metadata = new Uint8Array([viewTag]);

  return {
    schemeId: 1,
    stealthAddress,
    caller: 'GTEST0000000000000000000000000000000000000000000000000000',
    ephemeralPubKey: bytesToHex(ephemeralPubKey),
    metadata: bytesToHex(metadata),
    memo: { type: 'text', value: 'Wraith test stealth payment' },
  };
}
