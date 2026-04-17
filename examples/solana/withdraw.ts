/**
 * Withdraw from a Solana stealth address.
 *
 * Scans for incoming payments, derives the private scalar for a
 * matched stealth address, and shows how to sign a transfer
 * transaction to move funds to a destination.
 */
import {
  deriveStealthKeys,
  fetchAnnouncements,
  scanAnnouncements,
  deriveStealthPrivateScalar,
  signSolanaTransaction,
  pubKeyToSolanaAddress,
  getDeployment,
  STEALTH_SIGNING_MESSAGE,
} from '@wraith-protocol/sdk/chains/solana';

async function main() {
  // 1. Derive stealth keys
  const signature = new Uint8Array(64); // wallet.signMessage(STEALTH_SIGNING_MESSAGE)
  const keys = deriveStealthKeys(signature);

  // 2. Scan for payments
  const announcements = await fetchAnnouncements('solana');
  const payments = scanAnnouncements(
    announcements,
    keys.viewingKey,
    keys.spendingPubKey,
    keys.spendingScalar,
  );

  if (payments.length === 0) {
    console.log('No stealth payments found');
    return;
  }

  // 3. Pick a payment to withdraw
  const payment = payments[0];
  console.log('Stealth address:', payment.stealthAddress);
  console.log('Stealth public key:', pubKeyToSolanaAddress(payment.stealthPubKeyBytes));

  // 4. Independent scalar derivation also works
  const independentScalar = deriveStealthPrivateScalar(
    keys.spendingScalar,
    keys.viewingKey,
    payment.stealthPubKeyBytes, // ephemeral pub key from announcement
  );
  console.log('Scalars match:', independentScalar === payment.stealthPrivateScalar);

  // 5. Build and sign a withdrawal transaction
  //    Solana stealth addresses are regular ed25519 keypairs.
  //    No account deployment needed — just sign and send.
  //
  //    const connection = new Connection(deployment.rpcUrl);
  //    const stealthPubkey = new PublicKey(payment.stealthAddress);
  //    const destination = new PublicKey("...");
  //
  //    const tx = new Transaction().add(
  //      SystemProgram.transfer({
  //        fromPubkey: stealthPubkey,
  //        toPubkey: destination,
  //        lamports: balance - 5000, // minus tx fee
  //      }),
  //    );
  //
  //    const messageBytes = tx.serializeMessage();
  //    const sig = signSolanaTransaction(
  //      messageBytes,
  //      payment.stealthPrivateScalar,
  //      payment.stealthPubKeyBytes,
  //    );
  //    tx.addSignature(stealthPubkey, Buffer.from(sig));
  //    await connection.sendRawTransaction(tx.serialize());

  const deployment = getDeployment('solana');
  console.log('Explorer:', `https://explorer.solana.com/tx/?cluster=${deployment.network}`);
}

main().catch(console.error);
