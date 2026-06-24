# Compatibility Matrix

This file tracks the SDK's runtime support across the environments called out in issue #23.

| Runtime                      | Status  | Notes                                                                                                                                                                                                                                                                     |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node 20                      | Working | Verified with the full `vitest` suite and build output in CI.                                                                                                                                                                                                             |
| Node 22                      | Working | Verified locally and in CI. This is the current CI baseline.                                                                                                                                                                                                              |
| Bun latest                   | Working | Verified with `bun test` (232 pass, 1 skip) and `bun run build` in CI. Two test files that use vitest-only APIs (`vi.stubGlobal`, `vi.fn`, `vi.mock`) are excluded via `bunfig.toml`; all other tests pass natively.                                                      |
| Deno latest                  | Partial | Use the npm specifier form, for example `import { deriveStealthKeys } from "npm:@wraith-protocol/sdk@1.x/chains/stellar";`. The pure crypto modules are ESM-friendly; the Stellar announcement parser now lazy-loads `@stellar/stellar-sdk` instead of using `require()`. |
| Cloudflare Workers / workerd | Partial | The SDK itself is fetch-first and Web Crypto-friendly. The same Stellar lazy-import fix applies here. If you use the optional Stellar or Solana peer dependencies, bundle them explicitly.                                                                                |
| Vercel Edge                  | Partial | Same story as Workers: the core SDK works with standard Web APIs, while optional peer deps need to be bundled or avoided.                                                                                                                                                 |

## Verified Fixes

- Stellar announcement parsing no longer uses `require()` inside an ESM module.
- The Stellar announcement parser now loads `@stellar/stellar-sdk` lazily with `import()`.
- The test suite now includes a regression test for that code path.
- `src/chains/stellar/announcements.ts` was reconstructed from duplicate/corrupted declarations that caused a parse error (`Unexpected *`) under Bun's stricter parser.
- `test/compat/react-native.test.ts` uses a runtime probe to skip the `atob`/`btoa` polyfill test on Node 20+ and Bun, where these globals are non-deletable native builtins.
- `test/chains/stellar/fee-estimation.test.ts` and `test/chains/stellar/announcements.test.ts` use vitest-only APIs (`vi.stubGlobal`, `vi.fn`, `vi.mock`). They are excluded from `bun test` via `bunfig.toml` `pathIgnorePatterns` and continue to run under `pnpm test` (vitest).

## Bun Test Coverage

`bun test` runs 37 of 39 test files. The two excluded files test HTTP-fetch mocking behaviour that is already covered by the vitest suite:

| Excluded file                                | Reason                                                 |
| -------------------------------------------- | ------------------------------------------------------ |
| `test/chains/stellar/fee-estimation.test.ts` | Uses `vi.stubGlobal` / `vi.fn` (vitest-only)           |
| `test/chains/stellar/announcements.test.ts`  | Uses `vi.stubGlobal`, `vi.fn`, `vi.mock` (vitest-only) |

All EVM, Stellar, Solana, CKB crypto tests, the agent client, scanner pool, error taxonomy, IDB cache, and property-based tests pass under `bun test`.

## Remaining Caveats

- Deno and Workers support is documented from static review plus the Bun/Node verification we can run in this environment.
- If you need `fetchAnnouncements()` for Stellar on an edge runtime, make sure `@stellar/stellar-sdk` is available to the bundler or runtime.
