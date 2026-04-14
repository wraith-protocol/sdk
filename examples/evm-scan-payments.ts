/**
 * Scan for incoming stealth payments on Horizen.
 *
 * Fetches announcements from the Goldsky subgraph and checks which
 * ones belong to the recipient. For each match, derives the private key
 * that controls the stealth address.
 */
import {
  deriveStealthKeys,
  fetchAnnouncements,
  scanAnnouncements,
  STEALTH_SIGNING_MESSAGE,
} from '@wraith-protocol/sdk/chains/evm';

async function main() {
  // 1. Derive stealth keys from wallet signature
  const signature = '0x...'; // wallet.signMessage(STEALTH_SIGNING_MESSAGE)
  const keys = deriveStealthKeys(signature as `0x${string}`);

  // 2. Fetch all announcements from the chain
  const announcements = await fetchAnnouncements('horizen');
  console.log(`Found ${announcements.length} total announcements`);

  // 3. Scan for payments addressed to us
  const payments = scanAnnouncements(
    announcements,
    keys.viewingKey,
    keys.spendingPubKey,
    keys.spendingKey,
  );

  console.log(`Found ${payments.length} payments for this wallet`);

  for (const payment of payments) {
    console.log('Stealth address:', payment.stealthAddress);
    console.log('Private key:', payment.stealthPrivateKey);
    // Use privateKeyToAccount(payment.stealthPrivateKey) to spend
  }
}

main().catch(console.error);
