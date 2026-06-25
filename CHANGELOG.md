# Changelog

All notable changes to the Wraith Protocol SDK will be documented in this file.

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
- **Typing-Breaking for Brittle Matchers**: If your application catch blocks rely on exact substring matching against `error.message` (e.g. `if (e.message.includes('Expected 65-byte signature'))`), this change will break those assertions. You should migrate to use:

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
