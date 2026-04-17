/**
 * Send CKB privately to a recipient via stealth address.
 *
 * Generates a stealth address from the recipient's meta-address.
 * On CKB, the Cell itself IS the announcement — the lock script args
 * contain the ephemeral pubkey and blake160 hash of the stealth pubkey.
 * No separate announcer contract needed.
 */
import {
  deriveStealthKeys,
  encodeStealthMetaAddress,
  generateStealthAddress,
  getDeployment,
  STEALTH_SIGNING_MESSAGE,
} from '@wraith-protocol/sdk/chains/ckb';

// 1. Recipient derives their stealth keys from a wallet signature
//    In practice, the recipient does this once and shares their meta-address.
const recipientSignature = '0x...'; // wallet.signMessage(STEALTH_SIGNING_MESSAGE)
const recipientKeys = deriveStealthKeys(recipientSignature as `0x${string}`);
const recipientMetaAddress = encodeStealthMetaAddress(
  recipientKeys.spendingPubKey,
  recipientKeys.viewingPubKey,
);

console.log('Recipient meta-address:', recipientMetaAddress);
// "st:ckb:03dd...03e0..."

// 2. Sender generates a stealth address
const stealth = generateStealthAddress(recipientKeys.spendingPubKey, recipientKeys.viewingPubKey);

console.log('Stealth public key:', stealth.stealthPubKey);
console.log('Blake160 hash:', stealth.stealthPubKeyHash);
console.log('Ephemeral public key:', stealth.ephemeralPubKey);
console.log('Lock args (53 bytes):', stealth.lockArgs);

// 3. Build a CKB transaction with the stealth-lock script
//    The Cell's lock script uses the deployed stealth-lock code hash
//    and the lock args contain the announcement data.
const deployment = getDeployment('ckb');

console.log('Stealth-lock code hash:', deployment.contracts.stealthLockCodeHash);
console.log('Explorer:', deployment.explorerUrl);

// 4. Build and submit the transaction using CKB SDK:
//
//    const tx = {
//      outputs: [{
//        capacity: "0x" + (61_00000000n).toString(16), // 61 CKB minimum
//        lock: {
//          codeHash: deployment.contracts.stealthLockCodeHash,
//          hashType: "data2",
//          args: stealth.lockArgs,
//        },
//      }],
//      // ... inputs, change output, cell deps
//    };
//
//    Cell deps must include:
//    - stealthLock: { txHash: deployment.cellDeps.stealthLock.txHash, index: 0 }
//    - ckbAuth:     { txHash: deployment.cellDeps.ckbAuth.txHash, index: 0 }
