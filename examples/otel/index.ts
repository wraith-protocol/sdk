import { setTracer } from '@wraith-protocol/sdk';
import {
  deriveStealthKeys,
  generateStealthAddress,
  scanAnnouncementsStream,
  bytesToHex,
  SCHEME_ID,
  type Announcement,
} from '@wraith-protocol/sdk/chains/stellar';
import { createConsoleOtelTracer } from './console-otel-tracer';
import { createOtelTracerAdapter } from './otel-adapter';

async function* announcementsFrom(items: Announcement[]): AsyncGenerator<Announcement> {
  for (const item of items) yield item;
}

async function main() {
  console.log('=== Wraith SDK — OpenTelemetry-shaped tracer example ===\n');

  // Swap `createConsoleOtelTracer()` for a real `@opentelemetry/api` tracer —
  // see console-otel-tracer.ts for the one-line swap. Everything downstream
  // works unchanged either way, since createOtelTracerAdapter only depends on
  // the OTel Tracer/Span *shape*, not the package itself.
  const otelTracer = createConsoleOtelTracer();
  setTracer(createOtelTracerAdapter(otelTracer));

  console.log('1. Deriving stealth keys (span: stellar.deriveStealthKeys)');
  const keys = deriveStealthKeys(new Uint8Array(64).fill(0x42));

  console.log(
    '\n2. Generating a stealth address for ourselves (uninstrumented — pure crypto, no I/O)',
  );
  const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

  const announcement: Announcement = {
    schemeId: SCHEME_ID,
    stealthAddress: stealth.stealthAddress,
    caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
    metadata: stealth.viewTag.toString(16).padStart(2, '0'),
  };

  console.log(
    '\n3. Scanning a canned announcement batch (spans: stellar.scan, stellar.scan.match)',
  );
  const matches = [];
  for await (const match of scanAnnouncementsStream(
    announcementsFrom([announcement]),
    keys.viewingKey,
    keys.spendingPubKey,
    keys.spendingScalar,
  )) {
    matches.push(match);
  }

  console.log(`\nFound ${matches.length} match(es) for our own announcement.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
