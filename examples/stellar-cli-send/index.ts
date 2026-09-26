#!/usr/bin/env node
import {
  deriveStealthKeys,
  encodeStealthMetaAddress,
  generateStealthAddress,
  decodeStealthMetaAddress,
  getDeployment,
  STEALTH_SIGNING_MESSAGE,
  bytesToHex,
  SCHEME_ID,
} from '@wraith-protocol/sdk/chains/stellar';

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`ERROR: Missing environment variable ${name}`);
    console.error(`Copy .env.example to .env and fill in the values.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  console.log('=== Wraith Stellar CLI — Send Stealth Payment ===\n');

  // 1. Derive our stealth keys from a secret key
  //    In production, call wallet.sign(STEALTH_SIGNING_MESSAGE) instead.
  const secretKeyHex = getEnv('STELLAR_SECRET_KEY');
  const secretKeyBytes = new Uint8Array(secretKeyHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
  const ourKeys = deriveStealthKeys(secretKeyBytes);
  const ourMetaAddress = encodeStealthMetaAddress(ourKeys.spendingPubKey, ourKeys.viewingPubKey);
  console.log('Our stealth meta-address:', ourMetaAddress);
  console.log('');

  // 2. Decode the recipient's meta-address
  const recipientMetaAddress = getEnv('RECIPIENT_META_ADDRESS');
  const decoded = decodeStealthMetaAddress(recipientMetaAddress);
  console.log('Recipient meta-address:', recipientMetaAddress);
  console.log('Recipient spending pub key:', bytesToHex(decoded.spendingPubKey));
  console.log('Recipient viewing pub key:', bytesToHex(decoded.viewingPubKey));
  console.log('');

  // 3. Generate a stealth address for the recipient
  const stealth = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
  console.log('Generated stealth address:', stealth.stealthAddress);
  console.log('Ephemeral pub key:', bytesToHex(stealth.ephemeralPubKey));
  console.log('View tag:', stealth.viewTag);
  console.log('');

  // 4. Get deployment info
  const deployment = getDeployment('stellar');
  console.log('Network:', deployment.network);
  console.log('Horizon URL:', deployment.horizonUrl);
  console.log('Announcer contract:', deployment.contracts.announcer);
  console.log('');

  console.log('=== Done ===');
  console.log(`Send XLM to ${stealth.stealthAddress}, then announce via`);
  console.log(`the Soroban contract at ${deployment.contracts.announcer}`);
  console.log(`with scheme_id=${SCHEME_ID}, ephemeral_pub_key, and view_tag.`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
