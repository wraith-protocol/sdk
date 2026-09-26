#!/usr/bin/env node
import {
  deriveStealthKeys,
  fetchAnnouncementsStream,
  scanAnnouncements,
  bytesToHex,
  STEALTH_SIGNING_MESSAGE,
} from '@wraith-protocol/sdk/chains/stellar';

function getEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

async function main() {
  console.log('=== Wraith Stellar CLI — Scan Stealth Payments ===\n');

  // 1. Derive stealth keys from secret key
  const secretKeyHex = getEnv('STELLAR_SECRET_KEY');
  if (!secretKeyHex) {
    console.error('ERROR: Missing STELLAR_SECRET_KEY');
    console.error('Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
  const secretKeyBytes = new Uint8Array(secretKeyHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
  const keys = deriveStealthKeys(secretKeyBytes);
  console.log('Viewing key:', bytesToHex(keys.viewingKey));
  console.log('Spending pub key:', bytesToHex(keys.spendingPubKey));
  console.log('');

  // 2. Parse optional fromTimestamp
  const fromTimestampRaw = getEnv('FROM_TIMESTAMP');
  const fromTimestamp = fromTimestampRaw
    ? isNaN(Number(fromTimestampRaw))
      ? new Date(fromTimestampRaw)
      : new Date(Number(fromTimestampRaw) * 1000)
    : undefined;
  console.log('Scanning announcements from:', fromTimestamp?.toISOString() ?? 'beginning of time');
  console.log('');

  // 3. Collect announcements from the streaming API
  console.log('Fetching announcements...');
  const announcements = [];
  for await (const ann of fetchAnnouncementsStream('stellar', { fromTimestamp })) {
    announcements.push(ann);
  }
  console.log(`Found ${announcements.length} total announcements`);
  console.log('');

  // 4. Scan for payments addressed to us
  const payments = await scanAnnouncements(
    announcements,
    keys.viewingKey,
    keys.spendingPubKey,
    keys.spendingScalar,
  );
  console.log(`Found ${payments.length} payment(s) for this wallet`);
  console.log('');

  // 5. Print matches
  for (const payment of payments) {
    console.log('--- Matched Payment ---');
    console.log('Stealth address:', payment.stealthAddress);
    console.log('Stealth pub key:', bytesToHex(payment.stealthPubKeyBytes));
    console.log('Stealth private scalar:', payment.stealthPrivateScalar.toString());
    if (payment.memo) {
      console.log(`Memo [${payment.memo.type}]:`, payment.memo.value);
    }
    console.log('');
  }

  console.log('=== Done ===');
  if (payments.length === 0) {
    console.log('No stealth payments found for this wallet in the scanned range.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
