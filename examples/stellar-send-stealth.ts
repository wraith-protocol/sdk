/**
 * Send XLM privately to a recipient via stealth address on Stellar.
 *
 * Generates a stealth address from the recipient's meta-address,
 * sends XLM via createAccount, and announces on-chain via the
 * Soroban announcer contract.
 */
import {
  deriveStealthKeys,
  encodeStealthMetaAddress,
  generateStealthAddress,
  bytesToHex,
  getDeployment,
  STEALTH_SIGNING_MESSAGE,
  SCHEME_ID,
} from '@wraith-protocol/sdk/chains/stellar';

// 1. Recipient derives keys from a Stellar wallet signature
//    In practice, the recipient does this once and shares their meta-address.
const recipientSignature = new Uint8Array(64); // wallet.sign(STEALTH_SIGNING_MESSAGE)
const recipientKeys = deriveStealthKeys(recipientSignature);
const recipientMetaAddress = encodeStealthMetaAddress(
  recipientKeys.spendingPubKey,
  recipientKeys.viewingPubKey,
);

console.log('Recipient meta-address:', recipientMetaAddress);
// "st:xlm:ab12...cd34..."

// 2. Sender generates a stealth address
const stealth = generateStealthAddress(recipientKeys.spendingPubKey, recipientKeys.viewingPubKey);

console.log('Stealth address:', stealth.stealthAddress); // G...
console.log('Ephemeral pub key:', bytesToHex(stealth.ephemeralPubKey));
console.log('View tag:', stealth.viewTag);

// 3. Get deployment info
const deployment = getDeployment('stellar');
console.log('Horizon URL:', deployment.horizonUrl);
console.log('Announcer contract:', deployment.contracts.announcer);

// 4. Build and submit the Stellar transaction
//    Using @stellar/stellar-sdk:
//
//    const tx = new TransactionBuilder(sourceAccount, { fee: "100", networkPassphrase })
//      .addOperation(Operation.createAccount({
//        destination: stealth.stealthAddress,
//        startingBalance: "10",
//      }))
//      .setTimeout(30)
//      .build();
//
//    // Sign and submit to Horizon
//    tx.sign(senderKeypair);
//    await server.submitTransaction(tx);
//
// 5. Announce via Soroban contract
//    Call the announcer contract's `announce` function with:
//    - scheme_id: SCHEME_ID
//    - stealth_address: stealth.stealthAddress
//    - ephemeral_pub_key: stealth.ephemeralPubKey
//    - metadata: [stealth.viewTag] (as bytes)
