/**
 * Send SOL privately to a recipient via stealth address on Solana.
 *
 * Generates a stealth address from the recipient's meta-address.
 * On Solana, the stealth address is a regular ed25519 public key
 * encoded as a base58 address. SOL can be sent directly to it.
 */
import {
  deriveStealthKeys,
  encodeStealthMetaAddress,
  generateStealthAddress,
  bytesToHex,
  getDeployment,
  STEALTH_SIGNING_MESSAGE,
  SCHEME_ID,
} from '@wraith-protocol/sdk/chains/solana';

// 1. Recipient derives keys from a Solana wallet signature
//    In practice, the recipient does this once and shares their meta-address.
const recipientSignature = new Uint8Array(64); // wallet.signMessage(STEALTH_SIGNING_MESSAGE)
const recipientKeys = deriveStealthKeys(recipientSignature);
const recipientMetaAddress = encodeStealthMetaAddress(
  recipientKeys.spendingPubKey,
  recipientKeys.viewingPubKey,
);

console.log('Recipient meta-address:', recipientMetaAddress);
// "st:sol:ab12...cd34..."

// 2. Sender generates a stealth address
const stealth = generateStealthAddress(recipientKeys.spendingPubKey, recipientKeys.viewingPubKey);

console.log('Stealth address:', stealth.stealthAddress); // base58 Solana address
console.log('Ephemeral pub key:', bytesToHex(stealth.ephemeralPubKey));
console.log('View tag:', stealth.viewTag);

// 3. Send SOL to the stealth address and announce
//    Using @solana/web3.js:
//
//    const connection = new Connection(deployment.rpcUrl);
//    const tx = new Transaction().add(
//      SystemProgram.transfer({
//        fromPubkey: senderPubkey,
//        toPubkey: new PublicKey(stealth.stealthAddress),
//        lamports: 100_000_000, // 0.1 SOL
//      }),
//    );
//    await sendAndConfirmTransaction(connection, tx, [senderKeypair]);
//
// 4. Announce via the Wraith announcer program with:
//    - scheme_id: SCHEME_ID
//    - stealth_address: stealth.stealthAddress
//    - ephemeral_pub_key: stealth.ephemeralPubKey
//    - metadata: [stealth.viewTag]

const deployment = getDeployment('solana');
console.log('RPC URL:', deployment.rpcUrl);
