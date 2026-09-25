# Compatibility Matrix

`@wraith-protocol/sdk` is one package with several entry points, and each entry point has its own runtime and peer dependency requirements. This page is the contract: which runtimes are tested, against which dependency ranges, and what a consumer sees when they fall outside it.

[`compat/matrix.json`](./compat/matrix.json) holds the same data in machine-readable form and is the source of truth for the tables below. `pnpm test:compat` fails when that file, `package.json` and this page disagree, so none of the three can drift from the others.

## Supported runtimes

<!-- compat:runtimes:begin -->

| Runtime                          | Tested versions                                 | Status    | Covered by                                |
| -------------------------------- | ----------------------------------------------- | --------- | ----------------------------------------- |
| Node.js                          | 20.x, 22.x, 24.x                                | Supported | `pnpm test:compat` in the `compat` CI job |
| Bun                              | 1.1+                                            | Supported | `pnpm test:compat` in the `compat` CI job |
| Browsers (evergreen)             | Chrome 94+, Edge 94+, Firefox 93+, Safari 15.4+ | Supported | `pnpm test:compat` browser bundle check   |
| React Native                     | 0.72+ (Hermes), Expo SDK 51+                    | Supported | `pnpm test:compat` React Native check     |
| Deno                             | 2.x                                             | Partial   | Not covered by the compat job             |
| Cloudflare Workers / Vercel Edge | current                                         | Partial   | Not covered by the compat job             |

**Notes**

- **Node.js** — Covered by the `compat` CI job on every version and by the full Vitest suite. 20.x is upstream EOL (2026-04-30) and is retained for the 2.x line; 22.x is in maintenance and 24.x is the active LTS.
- **Bun** — Covered by the `compat` CI job. The ESM entry points, the Vitest suite (`bun test`) and the build all run unmodified.
- **Browsers (evergreen)** — Baseline is ES2022 plus `fetch`, `TextEncoder`/`TextDecoder` and `crypto.getRandomValues`; `./vault` additionally needs `crypto.subtle`. Optional peers are the app bundler's responsibility.
- **React Native** — Needs a `crypto.getRandomValues` polyfill (`react-native-get-random-values`) loaded before the SDK, plus `Buffer` if the app imports `@stellar/stellar-sdk` directly. `installReactNativePolyfills()` covers `atob`, `btoa`, `TextEncoder` and `TextDecoder`.
- **Deno** — Use npm specifiers. Verified by static review only — the compat job does not provision a Deno runtime yet.
- **Cloudflare Workers / Vercel Edge** — The browser bundle check covers the same module graph. Optional peers must be bundled explicitly when the edge entry point you use needs them.
<!-- compat:runtimes:end -->

## Dependency ranges

Peer dependencies are optional on purpose: an app that only uses `@wraith-protocol/sdk/chains/evm` should not be forced to install a Stellar or Solana SDK. Install a peer before importing the entry point that needs it.

<!-- compat:peers:begin -->

| Package                | Kind       | Supported range | Optional | Required by                         | Tested version |
| ---------------------- | ---------- | --------------- | -------- | ----------------------------------- | -------------- |
| `@stellar/stellar-sdk` | peer       | `^13.1.0`       | yes      | `./chains/stellar`                  | `13.3.0`       |
| `@solana/web3.js`      | peer       | `^1.95.0`       | yes      | `./chains/solana`                   | `1.98.4`       |
| `viem`                 | dependency | `^2.23.0`       | no       | `.`, `./chains/evm`, `./chains/ckb` | `2.47.14`      |

**Notes**

- **`@stellar/stellar-sdk`** — Required by `./chains/stellar`: the transaction builders, event filters and announcement parsing are re-exported from that entry point. Marked optional so apps that only use the EVM, CKB, Solana or vault entry points are not forced to install it.
- **`@solana/web3.js`** — Only `fetchAnnouncements()` needs it, and it imports the package dynamically on demand. Address derivation and scanning use the in-tree base58 encoder, so importing `./chains/solana` — or the package root — works without this peer installed.
- **`viem`** — A regular dependency, not a peer: the EVM and CKB modules use its hex and keccak helpers, and the wallet event normalizer uses `getAddress`. Bundled with the package, so consumers never install it separately.
<!-- compat:peers:end -->

## Unsupported combinations and failure messages

Each entry below is a combination that is deliberately not supported, together with the message you should expect to see. They are checked against the code where the message has a single source of truth (the React Native and vault errors are thrown by the SDK itself).

<!-- compat:unsupported:begin -->

#### Node.js 18 and older

```
Unsupported runtime: Node.js 18.x. @wraith-protocol/sdk requires Node.js >=20 (see package.json engines). See COMPAT.md for the supported matrix.
```

#### Bun 1.0 and older

```
Unsupported runtime: Bun 1.0.x. @wraith-protocol/sdk requires Bun >=1.1. See COMPAT.md for the supported matrix.
```

#### React Native without a crypto.getRandomValues polyfill

```
React Native requires a crypto polyfill. Install and import react-native-get-random-values before using @wraith-protocol/sdk.
```

#### Browsers or edge runtimes without WebCrypto, when using ./vault

```
KeyVault requires WebCrypto (crypto.subtle).
```

#### ./chains/stellar without @stellar/stellar-sdk installed

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@stellar/stellar-sdk' imported from @wraith-protocol/sdk/chains/stellar.
```

#### fetchAnnouncements() from ./chains/solana without @solana/web3.js installed

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@solana/web3.js' imported from @wraith-protocol/sdk/chains/solana.
```

#### Installing on a Node.js version below the declared engines range

```
npm ERR! code EBADENGINE
npm ERR! engine Unsupported engine
npm ERR! engine Not compatible with your version of node/npm: @wraith-protocol/sdk@1.x
npm ERR! notsup Required: {"node":">=20"}
```

#### TypeScript below 4.7 with node16 or bundler module resolution

```
Cannot find module '@wraith-protocol/sdk/chains/evm' or its corresponding type declarations.
```

<!-- compat:unsupported:end -->

## Running the checks

The matrix is enforced by `scripts/compat/`. Build first, then run the suite:

```bash
pnpm build
pnpm test:compat
```

`pnpm test:compat` runs four checks, each in its own child process:

| Check                                    | What it does                                                                                                                                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check.mjs`                              | Validates `compat/matrix.json` against `package.json` (`engines`, `peerDependencies`, `peerDependenciesMeta`, `dependencies`, `exports`) and regenerates the tables above.                                 |
| `verify-imports.mjs`                     | Detects the running runtime, refuses to continue with the documented message when it is unsupported, then imports every entry point and drives a stealth address flow on each chain module.                |
| `verify-imports.mjs --mode=react-native` | Repeats the above against a simulated Hermes global scope (no `atob`, `btoa`, `TextEncoder`, `TextDecoder`) after calling `installReactNativePolyfills()`.                                                 |
| `verify-package.mjs`                     | Bundles every entry point for `platform: browser`, imports every entry point from an install with the optional peers removed, and asserts the npm tarball contains every file the `exports` map points at. |

CI runs the suite on Node.js 20, 22 and 24 in the `compat` job, and runs the runtime check under Bun. The nightly `slow-tests` job still owns the long-running fuzz suites.

### Changing the matrix

Edit `compat/matrix.json`, then regenerate this page and re-run the checks:

```bash
pnpm compat:doc
pnpm test:compat
```

Adding a runtime means adding it to `compat/matrix.json`, giving it a `check` that `verify-imports.mjs` or `verify-package.mjs` implements, and, if it needs a scaffold, a job in `.github/workflows/ci.yml`.

## Runtime notes

- **Node.js** — 20.x is upstream EOL (2026-04-30) but is still covered while the 2.x line is supported. The package declares `engines.node` so npm and pnpm warn before an unsupported install proceeds.
- **Browsers** — the SDK is ESM, `fetch`-first and avoids Node builtins in authored source, which the package entry point smoke suite checks too. Optional peers are the app bundler's responsibility.
- **React Native** — call `installReactNativePolyfills()` at app startup and load `react-native-get-random-values` before the SDK. Without a `crypto.getRandomValues` polyfill the helper throws rather than deriving weak keys.
- **Deno, Cloudflare Workers, Vercel Edge** — documented, not covered by the compat job. Use npm specifiers in Deno, and bundle any optional peer an entry point needs.

## Related documentation

- [Getting Started](./docs/getting-started.mdx)
- [Running Wraith On The Edge](./docs/running-on-the-edge.md)
- [React Native Setup](./docs/guides/react-native-setup.mdx)
- [Contributing](./CONTRIBUTING.md) — semver policy for dependency and runtime range changes.
