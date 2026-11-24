# Running Wraith On The Edge

Wraith is designed around ESM, `fetch`, `TextEncoder`, `TextDecoder`, `AbortController`, and Web Crypto. That makes the core SDK a direct fit for edge and worker runtimes such as Cloudflare Workers, Deno, Bun, Vercel Edge, and standards-only browser Web Workers — without polyfilling Node `Buffer`, `process`, filesystem, or `node:crypto`.

> The canonical list of tested runtimes and supported dependency ranges lives in [COMPAT.md](../COMPAT.md). Cloudflare Workers (`workerd` via Miniflare without `nodejs_compat`), Deno 2.x, Bun 1.x, and standards-only Web Workers are all verified in CI via `scripts/compat/verify-edge-runtimes.mjs`.

## Bun

Install and run the repository tests or edge smoke fixture with Bun:

```bash
bun install
bun test
node scripts/compat/verify-edge-runtimes.mjs --runtime=bun
```

Import documented package subpaths directly:

```ts
import { deriveStealthKeys, generateStealthAddress } from '@wraith-protocol/sdk/chains/evm';
```

## Deno

Use npm specifiers when importing the published package in Deno 2.x:

```ts
import {
  deriveStealthKeys,
  decodeStealthMetaAddress,
} from 'npm:@wraith-protocol/sdk@1.x/chains/solana';
```

Run the Deno edge smoke fixture locally:

```bash
node scripts/compat/verify-edge-runtimes.mjs --runtime=deno
```

## Cloudflare Workers

Workers consume the ESM entry points directly inside `workerd` without enabling `nodejs_compat`:

```ts
import { scanAll } from '@wraith-protocol/sdk';
import {
  deriveStealthKeys,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  generateStealthAddress,
} from '@wraith-protocol/sdk/chains/evm';

export default {
  async fetch(request: Request) {
    const keys = deriveStealthKeys(`0x${'ab'.repeat(32)}${'cd'.repeat(32)}1b`);
    const meta = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
    const parsed = decodeStealthMetaAddress(meta);
    const stealth = generateStealthAddress(parsed.spendingPubKey, parsed.viewingPubKey);

    // Propagate request.signal to cancel in-flight scans when a client disconnects
    for await (const match of scanAll({
      evm: {
        source: (async function* () {})(),
        viewingKey: keys.viewingKey,
        spendingPubKey: keys.spendingPubKey,
        spendingKey: keys.spendingKey,
      },
    })) {
      if (request.signal.aborted) break;
      void match;
    }

    return Response.json({ stealthAddress: stealth.stealthAddress });
  },
};
```

## Web Workers & Vercel Edge

Dedicated browser Web Workers (`DedicatedWorkerGlobalScope`) and Vercel Edge functions use the same documented subpaths and Web Crypto globals. Optional peer dependencies (`@stellar/stellar-sdk`, `@solana/web3.js`) should be bundled explicitly when using helpers that depend on them.

## Unsupported Capabilities & Typed Errors

Browser-DOM-only modules (`@wraith-protocol/sdk/vault` `KeyVault`, which requires `window`, `document`, and `indexedDB`) and unbundled optional peer helpers (`fetchAnnouncements()` on `@wraith-protocol/sdk/chains/solana` when `@solana/web3.js` is absent) fail deterministically with `UnsupportedCapabilityError`:

```ts
import { UnsupportedCapabilityError } from '@wraith-protocol/sdk';
import { KeyVault } from '@wraith-protocol/sdk/vault';

try {
  new KeyVault();
} catch (err) {
  if (err instanceof UnsupportedCapabilityError) {
    console.error(err.code); // "WRAITH/RUNTIME/UNSUPPORTED_CAPABILITY"
    console.error(err.capability); // "window"
    console.error(err.describe()); // Actionable remediation guidance
  }
}
```
