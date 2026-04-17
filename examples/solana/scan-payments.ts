/**
 * Scan for incoming stealth payments on Solana.
 *
 * Fetches announcements from the Wraith announcer program's
 * transaction history and checks which ones belong to the recipient.
 * For each match, derives the private scalar needed to sign
 * transactions from the stealth address.
 */
import {
  deriveStealthKeys,
  fetchAnnouncements,
  scanAnnouncements,
  signSolanaTransaction,
  pubKeyToSolanaAddress,
  STEALTH_SIGNING_MESSAGE,
} from '@wraith-protocol/sdk/chains/solana';

async function main() {
  // 1. Derive stealth keys from wallet signature
  const signature = new Uint8Array(64); // wallet.signMessage(STEALTH_SIGNING_MESSAGE)
  const keys = deriveStealthKeys(signature);

  // 2. Fetch announcements from Solana
  const announcements = await fetchAnnouncements('solana');
  console.log(`Found ${announcements.length} total announcements`);

  // 3. Scan for payments addressed to us
  const payments = scanAnnouncements(
    announcements,
    keys.viewingKey,
    keys.spendingPubKey,
    keys.spendingScalar,
  );

  console.log(`Found ${payments.length} payments for this wallet`);

  for (const payment of payments) {
    console.log('Stealth address:', payment.stealthAddress);
    console.log('Stealth public key:', pubKeyToSolanaAddress(payment.stealthPubKeyBytes));

    // 4. To spend from this stealth address, sign a transaction:
    //
    //    const txMessage = transaction.serializeMessage();
    //    const sig = signSolanaTransaction(
    //      txMessage,
    //      payment.stealthPrivateScalar,
    //      payment.stealthPubKeyBytes,
    //    );
    //    transaction.addSignature(
    //      new PublicKey(payment.stealthAddress),
    //      Buffer.from(sig),
    //    );
  }
}

main().catch(console.error);
