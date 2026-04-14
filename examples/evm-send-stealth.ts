/**
 * Send ETH privately to a recipient via stealth address on Horizen.
 *
 * This example generates a stealth address from the recipient's meta-address
 * and builds a transaction using the WraithSender contract for atomic
 * send + announce. The transaction can be submitted with any EVM library.
 */
import {
  deriveStealthKeys,
  encodeStealthMetaAddress,
  buildSendStealth,
  STEALTH_SIGNING_MESSAGE,
} from '@wraith-protocol/sdk/chains/evm';

// 1. Recipient derives their stealth keys from a wallet signature
//    In practice, the recipient does this once and shares their meta-address.
const recipientSignature = '0x...'; // wallet.signMessage(STEALTH_SIGNING_MESSAGE)
const recipientKeys = deriveStealthKeys(recipientSignature as `0x${string}`);
const recipientMetaAddress = encodeStealthMetaAddress(
  recipientKeys.spendingPubKey,
  recipientKeys.viewingPubKey,
);

console.log('Recipient meta-address:', recipientMetaAddress);
// "st:eth:0x03dd...03e0..."

// 2. Sender builds the stealth payment transaction
const { transaction, stealthAddress, ephemeralPubKey, viewTag } = buildSendStealth({
  recipientMetaAddress,
  amount: '0.1',
  chain: 'horizen',
});

console.log('Stealth address:', stealthAddress);
console.log('Transaction:', transaction);
// { to: "0x226C...", data: "0x...", value: 100000000000000000n }

// 3. Submit with your preferred library:
//
// viem:
//   await walletClient.sendTransaction(transaction);
//
// ethers v6:
//   await signer.sendTransaction(transaction);
//
// wagmi:
//   await sendTransaction(transaction);
