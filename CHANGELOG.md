# Changelog

All notable changes to the Wraith Protocol SDK will be documented in this file.

## Upcoming: 2.0.0

### Added

- **Stellar `StellarStealthSigner` Interface** (issue #121): `deriveStealthKeys()` now has a signer-based counterpart, `deriveStealthKeysFromSigner()`, that accepts any `StellarStealthSigner` (`{ signMessage(message): Promise<Uint8Array> }`) instead of assuming a synchronous Freighter-shaped ed25519 signature.
  - `FreighterStealthSigner` wraps the existing Freighter-style wallet API; the raw `deriveStealthKeys(signature)` path is unchanged.
  - `WebAuthnPasskeyStealthSigner` is a reference passkey adapter that uses the WebAuthn `prf` extension to derive stable key material across sessions, since raw WebAuthn assertion signatures are non-deterministic.
  - `useStellarStealthKeys()` in `@wraith-protocol/sdk-react` gained a `generateFromSigner()` method alongside the existing `generate()`.

### Performance

- **Stellar Streaming Scan Pipelining** (issue #126): `scanAnnouncementsStream` now pulls its `source` through a bounded pipeline (`src/chains/stellar/scanner/pipeline.ts`) instead of prefetching a strict window before scanning it, so RPC fetches for later pages overlap with CPU work scanning earlier ones. Peak memory stays O(window). `fetchAnnouncementsStream` and `scanAnnouncementsStream`'s public shapes are unchanged; the old windowed algorithm is retained as `scanAnnouncementsStreamSequential` for benchmark comparisons. See [`docs/chains/stellar-streaming-scan-pipeline.md`](./docs/chains/stellar-streaming-scan-pipeline.md) — measured 36% wall-clock reduction on the 10k-announcement canned benchmark.

### Changed

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
