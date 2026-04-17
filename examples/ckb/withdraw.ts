/**
 * Withdraw from a CKB stealth address.
 *
 * Scans for incoming stealth cells, derives the private key for a
 * matched cell, and explains how to consume the Cell and send funds
 * to a destination address.
 */
import {
  deriveStealthKeys,
  fetchStealthCells,
  scanStealthCells,
  deriveStealthPrivateKey,
  getDeployment,
  STEALTH_SIGNING_MESSAGE,
} from '@wraith-protocol/sdk/chains/ckb';

async function main() {
  // 1. Derive stealth keys
  const signature = '0x...'; // wallet.signMessage(STEALTH_SIGNING_MESSAGE)
  const keys = deriveStealthKeys(signature as `0x${string}`);

  // 2. Scan for payments
  const cells = await fetchStealthCells('ckb');
  const payments = scanStealthCells(cells, keys.viewingKey, keys.spendingPubKey, keys.spendingKey);

  if (payments.length === 0) {
    console.log('No stealth payments found');
    return;
  }

  // 3. Pick a payment to withdraw
  const payment = payments[0];
  const capacityCKB = Number(payment.capacity) / 100_000_000;
  console.log('Stealth cell:', `${payment.txHash}#${payment.index}`);
  console.log('Capacity:', `${capacityCKB} CKB`);
  console.log('Private key:', payment.stealthPrivateKey);

  // 4. Independent derivation also works
  const independentKey = deriveStealthPrivateKey(
    keys.spendingKey,
    payment.ephemeralPubKey,
    keys.viewingKey,
  );
  console.log('Keys match:', independentKey === payment.stealthPrivateKey);

  // 5. Build and submit a withdrawal transaction
  //    On CKB, spending means consuming the stealth Cell and creating
  //    a new Cell at the destination address.
  //
  //    const tx = {
  //      inputs: [{
  //        previousOutput: { txHash: payment.txHash, index: payment.index },
  //        since: "0x0",
  //      }],
  //      outputs: [{
  //        capacity: "0x" + (payment.capacity - 1000n).toString(16), // minus fee
  //        lock: destinationLockScript,
  //      }],
  //      witnesses: ["0x..."], // signature with stealth private key
  //      cellDeps: [
  //        { outPoint: deployment.cellDeps.stealthLock, depType: "code" },
  //        { outPoint: deployment.cellDeps.ckbAuth, depType: "code" },
  //      ],
  //    };
  //
  //    Sign the transaction hash with the stealth private key using secp256k1.
  //    The stealth-lock script verifies that blake160(recovered_pubkey) matches
  //    the hash stored in the cell's lock args[33:53].

  const deployment = getDeployment('ckb');
  console.log('Explorer:', `${deployment.explorerUrl}/transaction/${payment.txHash}`);
}

main().catch(console.error);
