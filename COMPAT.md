# Compatibility Matrix

This file tracks the SDK's runtime support across the environments called out in issue #23.

| Runtime                      | Status  | Notes                                                                                                                                                                                                                                                                     |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node 20                      | Working | Verified with the full `vitest` suite and build output in CI.                                                                                                                                                                                                             |
| Node 22                      | Working | Verified locally and in CI. This is the current CI baseline.                                                                                                                                                                                                              |
| Bun latest                   | Working | Verified locally with `bun test` and `bun run build`.                                                                                                                                                                                                                     |
| Deno latest                  | Partial | Use the npm specifier form, for example `import { deriveStealthKeys } from "npm:@wraith-protocol/sdk@1.x/chains/stellar";`. The pure crypto modules are ESM-friendly; the Stellar announcement parser now lazy-loads `@stellar/stellar-sdk` instead of using `require()`. |
| Cloudflare Workers / workerd | Partial | The SDK itself is fetch-first and Web Crypto-friendly. The same Stellar lazy-import fix applies here. If you use the optional Stellar or Solana peer dependencies, bundle them explicitly.                                                                                |
| Vercel Edge                  | Partial | Same story as Workers: the core SDK works with standard Web APIs, while optional peer deps need to be bundled or avoided.                                                                                                                                                 |

## Verified Fixes

- Stellar announcement parsing no longer uses `require()` inside an ESM module.
- The Stellar announcement parser now loads `@stellar/stellar-sdk` lazily with `import()`.
- The test suite now includes a regression test for that code path.

## Remaining Caveats

- Deno and Workers support is documented from static review plus the Bun/Node verification we can run in this environment.
- If you need `fetchAnnouncements()` for Stellar on an edge runtime, make sure `@stellar/stellar-sdk` is available to the bundler or runtime.
