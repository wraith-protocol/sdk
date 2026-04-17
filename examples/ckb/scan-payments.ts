/**
 * Scan for incoming stealth payments on CKB.
 *
 * On CKB, there are no separate announcement events. The Cells themselves
 * ARE the announcements — each stealth-lock Cell's args contain the
 * ephemeral pubkey and blake160 hash. We query live Cells with the
 * stealth-lock code hash and check each one against our viewing key.
 */
import {
  deriveStealthKeys,
  fetchStealthCells,
  scanStealthCells,
  getDeployment,
  STEALTH_SIGNING_MESSAGE,
} from '@wraith-protocol/sdk/chains/ckb';

async function main() {
  // 1. Derive stealth keys from wallet signature
  const signature = '0x...'; // wallet.signMessage(STEALTH_SIGNING_MESSAGE)
  const keys = deriveStealthKeys(signature as `0x${string}`);

  // 2. Fetch all live stealth cells from CKB via get_cells RPC
  //    This queries all Cells using the stealth-lock code hash.
  const cells = await fetchStealthCells('ckb');
  console.log(`Found ${cells.length} total stealth cells`);

  // 3. Scan for cells belonging to us
  //    No view tag optimization on CKB — every Cell is fully checked.
  const payments = scanStealthCells(cells, keys.viewingKey, keys.spendingPubKey, keys.spendingKey);

  console.log(`Found ${payments.length} payments for this wallet`);

  const deployment = getDeployment('ckb');

  for (const payment of payments) {
    const capacityCKB = Number(payment.capacity) / 100_000_000;
    console.log(`  TX: ${payment.txHash}#${payment.index}`);
    console.log(`  Capacity: ${capacityCKB} CKB`);
    console.log(`  Private key: ${payment.stealthPrivateKey}`);
    console.log(`  Explorer: ${deployment.explorerUrl}/transaction/${payment.txHash}`);
    console.log();
  }
}

main().catch(console.error);
