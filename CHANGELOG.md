# Changelog

All notable changes to the Wraith Protocol SDK will be documented in this file.

## Upcoming: 2.0.0

### Added

- **Supported Runtime and Peer Dependency Matrix** (issue #209): `compat/matrix.json` is now the single source of truth for the runtimes the SDK supports — Node.js, Bun, evergreen browsers and React Native — and for the dependency ranges it accepts (`@stellar/stellar-sdk`, `@solana/web3.js`, `viem`).
  - [`COMPAT.md`](./COMPAT.md) is generated from that file and documents the unsupported combinations alongside the exact failure message each one produces.
  - `pnpm test:compat` validates the matrix against `package.json` and `COMPAT.md`, imports every entry point on the running runtime, repeats that against a simulated React Native global scope, bundles every entry point for `platform: browser`, imports every entry point from an install with the optional peers removed, and asserts the npm tarball contains every file the `exports` map points at.
  - `package.json` now declares `engines.node` (`>=20`), so an unsupported Node.js install warns before the first import.
  - The new `compat` CI job runs the checks on Node.js 20, 22 and 24 plus Bun, and the full suite and entry point smoke tests now cover Node.js 24 as well.
- **Solana address derivation without `@solana/web3.js`** (issue #209): `pubKeyToSolanaAddress()` uses the in-tree base58 encoder, so importing the package root or `@wraith-protocol/sdk/chains/solana` no longer requires the optional Solana peer. Only `fetchAnnouncements()` loads `@solana/web3.js`, dynamically on demand.
- **Stellar `StellarStealthSigner` Interface** (issue #121): `deriveStealthKeys()` now has a signer-based counterpart, `deriveStealthKeysFromSigner()`, that accepts any `StellarStealthSigner` (`{ signMessage(message): Promise<Uint8Array> }`) instead of assuming a synchronous Freighter-shaped ed25519 signature.
  - `FreighterStealthSigner` wraps the existing Freighter-style wallet API; the raw `deriveStealthKeys(signature)` path is unchanged.
  - `WebAuthnPasskeyStealthSigner` is a reference passkey adapter that uses the WebAuthn `prf` extension to derive stable key material across sessions, since raw WebAuthn assertion signatures are non-deterministic.
  - `useStellarStealthKeys()` in `@wraith-protocol/sdk-react` gained a `generateFromSigner()` method alongside the existing `generate()`.
- **OpenTelemetry-compatible Instrumentation Hooks** (issue #177): `src/telemetry.ts` introduces a minimal `Tracer`/`Span` interface plus `setTracer()`/`getTracer()`, exported from the package root. Zero runtime dependency on `@opentelemetry/*` or any tracing library — nothing is traced until `setTracer()` is called, and every instrumented call site defaults to a no-op tracer.
  - Instrumented: `deriveStealthKeys()`, `deriveStealthKeysFromSigner()`, `scanAnnouncementsStream()` (`stellar.scan` plus a `stellar.scan.match` span per match), `RpcClient.request()` (`stellar.rpc.request`, covering internal retries/failover), and every `ClaudeAgentTools` method (`agent.tool.*`).
  - Every instrumented function accepts a `tracer` option that overrides the global tracer for that call only.
  - `scanAnnouncementsStream` is now exported from `@wraith-protocol/sdk/chains/stellar` (it previously wasn't part of the public API surface, only reachable via a relative import).
  - Reference `@opentelemetry/api`-shaped adapter under `examples/otel/`; stable attribute names documented in `docs/observability.md`.
- **Package Entry Point Smoke Tests** (issue #205): a dedicated CI job builds the package and imports every `exports` subpath through both its ESM and CommonJS conditions, verifies each entry point's TypeScript declarations resolve, and asserts no entry point's authored source imports a Node-only builtin. Fixtures live in `test/smoke/` and run via `pnpm test:exports` across the supported Node versions.
- **Wallet Adapter Error Taxonomy, Events and Conformance Tests** (issue #214): viem, Solana wallet-adapter and Freighter failures now map onto one error family, and their account and network changes onto one event shape.
  - `WraithWalletError` and its subclasses `WalletNotConnectedError`, `WalletUserRejectedError`, `WalletWrongNetworkError`, `WalletUnavailableError` and `WalletRequestFailedError`, exported from the package root.
  - `normalizeWalletError()` maps EIP-1193 and viem errors, Solana wallet-adapter errors and Freighter error results onto the taxonomy, keeping the original on `cause`. `withNormalizedWalletErrors()` wraps an adapter so its methods reject with normalised errors.
  - `watchWalletEvents()` reports `accountChanged`, `networkChanged` and `disconnect` events from an EIP-1193 provider, an `@solana/wallet-adapter` adapter or Freighter's `WatchWalletChanges`.
  - `ViemWalletAdapter.getNetwork()`, `FreighterWalletAdapter.getNetwork()` and `assertWalletNetwork()` for wrong-network checks.
  - Opt-in and backward compatible: the adapters' `signMessage()` and `getAddress()` throw the same errors as before. See [`docs/wallet-adapters.md`](./docs/wallet-adapters.md).
- **Request Timeouts for the Stellar Horizon and RPC Clients** (issue #202): `createHorizonClient()` and `createRpcClient()` accept `timeouts: { connectMs, requestMs }`, and each call can override them.
  - `connectMs` (default 10 s) covers everything up to the response headers; `requestMs` (default 30 s) covers the whole attempt, body included. `0` turns either off.
  - A timed-out attempt is aborted before the client retries or fails over. The fetch and the body read are raced against the deadline, so a `fetch` that ignores the abort signal cannot hang the request.
  - New `RPCTimeoutError` (`WRAITH/NETWORK/RPC_TIMEOUT`), exported from the package root, carries the URL, endpoint, attempt number, which timeout fired and its length. When every attempt fails, `RPCRetryExhaustedError` keeps the last attempt's error on `cause`.
  - `createRpcClient()` now marks an endpoint healthy only after the response body has been read, so an endpoint that sends headers and then stalls still trips the circuit breaker. See [`docs/chains/stellar-request-timeouts.md`](./docs/chains/stellar-request-timeouts.md).

### Performance

- **Stellar Streaming Scan Pipelining** (issue #126): `scanAnnouncementsStream` now pulls its `source` through a bounded pipeline (`src/chains/stellar/scanner/pipeline.ts`) instead of prefetching a strict window before scanning it, so RPC fetches for later pages overlap with CPU work scanning earlier ones. Peak memory stays O(window). `fetchAnnouncementsStream` and `scanAnnouncementsStream`'s public shapes are unchanged; the old windowed algorithm is retained as `scanAnnouncementsStreamSequential` for benchmark comparisons. See [`docs/chains/stellar-streaming-scan-pipeline.md`](./docs/chains/stellar-streaming-scan-pipeline.md) — measured 36% wall-clock reduction on the 10k-announcement canned benchmark.

### Changed

- **Stellar Horizon and RPC Clients Time Out by Default** (issue #202): an attempt now fails after 10 s without response headers or 30 s in total, then retries or fails over, instead of waiting indefinitely. Pass `timeouts: { connectMs: 0, requestMs: 0 }` for the old behaviour, or longer values for slow calls such as Horizon transaction submission.
- **Stellar Chain Module Cryptographic Audit Fixes**: Applied all findings from independent cryptographic audit (issue #55). Breaking changes:
  - `scanAnnouncements()` now skips candidates with zero derived scalars (cryptographically required, probability ~1 in 2^255).
  - View-tag computation optimized using ephemeralPubKey ⊕ viewingPubKey prefilter (1.5–2x faster, functionally identical).
  - See [MIGRATING.md § Stellar Audit Fixes](./MIGRATING.md#stellar-cryptographic-audit-fixes-150) for details.

## [1.5.0] - 2026-05-31

### Added

- **Typed Error Taxonomy & Hierarchy**: Introduced a robust, typed error hierarchy under `src/errors.ts` (exported from the SDK root entry point) to allow consumers to programmatically handle different error categories without brittle string matching on `error.message`.
  - **Base Errors**: `WraithError` (abstract base), `WraithInputError`, `WraithCryptoError`, `WraithNetworkError`, `WraithContractError`, `WraithBuilderError`.
  - **Subclass Errors**:
    - _Inputs_: `InvalidMetaAddressError`, `InvalidNameError`, `InvalidSignatureError`, `InvalidScalarError`.
    - _Cryptography_: `KeyDerivationFailedError`, `ViewTagMismatchError`, `ECDHFailedError`.
    - _Network_: `RPCRequestError`, `RPCRetryExhaustedError`, `RetentionExceededError`.
    - _Smart Contracts_: `NameNotFoundError`, `NameAlreadyRegisteredError`, `InsufficientAuthError`, `ContractRevertError`.
    - _Builders_: `InsufficientBalanceError`, `UnsupportedAssetError`.
- **Serialization Support**: Custom error classes implement `toJSON()` and carry enumerable, public structured context fields, guaranteeing that `JSON.stringify(error)` preserves the stable code constants (e.g. `"WRAITH/CRYPTO/VIEW_TAG_MISMATCH"`), names, messages, and docs links.
- **Reference Documentation Links**: Every error instance now automatically includes a `docsLink` property pointing directly to the detailed error reference page on `https://docs.wraith.dev/sdk/errors`, which is also appended to the human-readable `message`.

### Changed

- **Codebase-wide Custom Error Migration**: Replaced generic JavaScript `Error` instances throughout the codebase (in EVM, Stellar, Solana, and CKB modules) with appropriate typed exceptions.
- **JSDoc Annotations**: Updated JSDoc `@throws` annotations across primary functions to reflect the precise custom error types thrown.

### Migration / Breaking Change Notice

- **Runtime Non-Breaking**: This release is fully backwards-compatible at a runtime level for applications that catch errors as generic JS `Error` instances, since all custom exceptions extend the native `Error` class.
- **Typing-Breaking for Brittle Matchers**: If your application catch blocks rely on exact substring matching against `error.message` (e.g. `if (e.message.includes('Expected 65-byte signature'))`), this change will break those assertions. See [MIGRATING.md § Error Handling](./MIGRATING.md#error-handling-from-message-matching-to-typed-exceptions-150) for detailed migration steps and code examples.

  Quick example:

  ```typescript
  import { InvalidSignatureError } from '@wraith-protocol/sdk';

  try {
    // ...
  } catch (e) {
    if (e instanceof InvalidSignatureError) {
      // Handle invalid signature specifically with rich structured context
      console.log(e.context.expectedLength);
    }
  }
  ```

- **React Native**: New applications targeting React Native must call `installReactNativePolyfills()` at startup. See [MIGRATING.md § React Native](./MIGRATING.md#react-native-explicit-polyfill-installation-required-150) for integration instructions.
