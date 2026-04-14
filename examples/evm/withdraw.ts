/**
 * Withdraw from a stealth address on Horizen.
 *
 * Scans for incoming payments, derives the private key for a matched
 * stealth address, and sends the funds to a destination.
 */
import {
  deriveStealthKeys,
  fetchAnnouncements,
  scanAnnouncements,
  getDeployment,
  STEALTH_SIGNING_MESSAGE,
} from '@wraith-protocol/sdk/chains/evm';

async function main() {
  // 1. Derive stealth keys
  const signature = '0x...'; // wallet.signMessage(STEALTH_SIGNING_MESSAGE)
  const keys = deriveStealthKeys(signature as `0x${string}`);

  // 2. Scan for payments
  const announcements = await fetchAnnouncements('horizen');
  const payments = scanAnnouncements(
    announcements,
    keys.viewingKey,
    keys.spendingPubKey,
    keys.spendingKey,
  );

  if (payments.length === 0) {
    console.log('No stealth payments found');
    return;
  }

  // 3. For each payment, the stealthPrivateKey is already derived
  const payment = payments[0];
  console.log('Stealth address:', payment.stealthAddress);
  console.log('Private key:', payment.stealthPrivateKey);

  // 4. Use the private key to send funds out
  //    The private key controls the stealth address like any regular EOA.
  //
  // viem:
  //   const account = privateKeyToAccount(payment.stealthPrivateKey);
  //   const client = createWalletClient({ account, chain, transport: http(rpcUrl) });
  //   await client.sendTransaction({ to: destination, value: amount });
  //
  // ethers:
  //   const wallet = new ethers.Wallet(payment.stealthPrivateKey, provider);
  //   await wallet.sendTransaction({ to: destination, value: amount });

  const deployment = getDeployment('horizen');
  console.log('RPC URL:', deployment.rpcUrl);
  console.log('Explorer:', `${deployment.explorerUrl}/address/${payment.stealthAddress}`);
}

main().catch(console.error);
