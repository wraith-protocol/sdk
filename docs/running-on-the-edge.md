# Running Wraith On The Edge

Wraith is designed around ESM, `fetch`, `TextEncoder`, `TextDecoder`, and Web Crypto. That makes the core SDK a good fit for edge runtimes such as Bun, Deno, Cloudflare Workers, and Vercel Edge.

## Bun

Install and run the repository tests with Bun:

```bash
bun install
bun test
bun run build
```

If you only need the package in an app, import the same entry points you would use in Node:

```ts
import { deriveStealthKeys } from '@wraith-protocol/sdk/chains/stellar';
```

## Deno

Use npm specifiers when importing the published package:

```ts
import { deriveStealthKeys } from 'npm:@wraith-protocol/sdk@1.x/chains/stellar';
```

If you need the Stellar announcement parser, make sure the optional `@stellar/stellar-sdk` dependency is available to the runtime or bundler.

## Cloudflare Workers

Workers can consume the ESM entry points directly. The SDK does not require `Buffer` or `fs`, and the Stellar parser now uses dynamic `import()` instead of `require()`.

Minimal worker example:

```ts
import { deriveStealthKeys } from '@wraith-protocol/sdk/chains/stellar';

export default {
  async fetch() {
    const keys = deriveStealthKeys(new Uint8Array(64).fill(0xaa));
    return Response.json({ spendingKeyLength: keys.spendingKey.length });
  },
};
```

## Vercel Edge

Use the same import style as Workers. If you are only scanning/generating addresses, the pure crypto exports are the safest path. Optional peer dependencies such as `@stellar/stellar-sdk` and `@solana/web3.js` should be bundled explicitly if you use those chain modules.

## What Changed For Edge Support

- The Stellar announcement parser now lazy-loads `@stellar/stellar-sdk`.
- The pure chain modules are ESM-only and avoid Node-specific APIs.
- Bun is covered in CI so regressions show up before release.
