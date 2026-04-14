/**
 * Scan for incoming stealth payments on Stellar.
 *
 * Fetches announcements from the Soroban RPC and checks which ones
 * belong to the recipient. For each match, derives the private scalar
 * needed to sign transactions from the stealth address.
 */
import {
  deriveStealthKeys,
  fetchAnnouncements,
  scanAnnouncements,
  signStellarTransaction,
  pubKeyToStellarAddress,
  STEALTH_SIGNING_MESSAGE,
} from '@wraith-protocol/sdk/chains/stellar';

async function main() {
  // 1. Derive stealth keys from wallet signature
  const signature = new Uint8Array(64); // wallet.sign(STEALTH_SIGNING_MESSAGE)
  const keys = deriveStealthKeys(signature);

  // 2. Fetch announcements from Soroban RPC
  const announcements = await fetchAnnouncements('stellar');
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
    console.log('Stealth public key:', pubKeyToStellarAddress(payment.stealthPubKeyBytes));

    // 4. To spend from this stealth address, sign a transaction:
    //
    //    const txHash = transaction.hash();
    //    const sig = signStellarTransaction(
    //      txHash,
    //      payment.stealthPrivateScalar,
    //      payment.stealthPubKeyBytes,
    //    );
    //    transaction.addSignature(
    //      pubKeyToStellarAddress(payment.stealthPubKeyBytes),
    //      sig,
    //    );
  }
}

main().catch(console.error);
