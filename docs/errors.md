# SDK Error Handling Guide

The Wraith Protocol SDK (`@wraith-protocol/sdk`) provides a highly granular, typed hierarchy of custom error classes. This taxonomy allows developers to programmatically catch and handle specific error conditions without having to parse error message strings.

All custom errors extend a base `WraithError` class, which extends the native JavaScript `Error` class, ensuring complete backwards-compatibility.

---

## The Error Hierarchy

All custom exceptions are organized under five major categories:

```
WraithError (Abstract Base)
├── WraithInputError
│   ├── InvalidMetaAddressError
│   ├── InvalidNameError
│   ├── InvalidSignatureError
│   └── InvalidScalarError
├── WraithCryptoError
│   ├── KeyDerivationFailedError
│   ├── ViewTagMismatchError
│   └── ECDHFailedError
├── WraithNetworkError
│   ├── RPCRequestError
│   ├── RPCRetryExhaustedError
│   └── RetentionExceededError
├── WraithContractError
│   ├── NameNotFoundError
│   ├── NameAlreadyRegisteredError
│   ├── InsufficientAuthError
│   └── ContractRevertError
└── WraithBuilderError
    ├── InsufficientBalanceError
    └── UnsupportedAssetError
```

---

## Reference & Stable Codes

Each error subclass contains three public properties:

1.  `name`: The name of the error class matching its type.
2.  `code`: A stable, serializable uppercase constant string (e.g. `"WRAITH/CRYPTO/VIEW_TAG_MISMATCH"`) to preserve identity across execution boundaries (e.g. logging servers or frontend-backend API bridges).
3.  `context`: A structured object containing domain-specific context.
4.  `docsLink`: A link pointing directly to the reference explanation.

### 1. Input Validation Errors (`WraithInputError`)

Thrown when parameters supplied to SDK functions fail syntactic, length, or boundary validation checks.

| Error Class               | Stable Code                           | Context Fields                                | Description                                                                            |
| :------------------------ | :------------------------------------ | :-------------------------------------------- | :------------------------------------------------------------------------------------- |
| `InvalidMetaAddressError` | `"WRAITH/INPUT/INVALID_META_ADDRESS"` | `metaAddress`, `reason`                       | Thrown when a stealth meta-address has an invalid prefix, length, or points.           |
| `InvalidNameError`        | `"WRAITH/INPUT/INVALID_NAME"`         | `name`, `reason`                              | Thrown when a `.wraith` name is invalid (e.g. incorrect length, bad characters).       |
| `InvalidSignatureError`   | `"WRAITH/INPUT/INVALID_SIGNATURE"`    | `signature`, `expectedLength`, `actualLength` | Thrown when a cryptographic signature has an incorrect length or invalid format.       |
| `InvalidScalarError`      | `"WRAITH/INPUT/INVALID_SCALAR"`       | `scalar`, `reason`                            | Thrown when a computed private key scalar is out of valid bounds (e.g. is zero mod n). |

### 2. Cryptographic Errors (`WraithCryptoError`)

Thrown when low-level mathematical operations or elliptic curve calculations fail.

| Error Class                | Stable Code                             | Context Fields             | Description                                                                              |
| :------------------------- | :-------------------------------------- | :------------------------- | :--------------------------------------------------------------------------------------- |
| `KeyDerivationFailedError` | `"WRAITH/CRYPTO/KEY_DERIVATION_FAILED"` | `reason`                   | Thrown when signature-to-stealth key derivations fail valid curve range checks.          |
| `ViewTagMismatchError`     | `"WRAITH/CRYPTO/VIEW_TAG_MISMATCH"`     | `expectedTag`, `actualTag` | Thrown when scanning announcements if view tag filters don't align.                      |
| `ECDHFailedError`          | `"WRAITH/CRYPTO/ECDH_FAILED"`           | `reason`                   | Thrown when elliptic curve Diffie-Hellman operations fail (e.g. public point off curve). |

### 3. Network & Connection Errors (`WraithNetworkError`)

Thrown when HTTP queries to Wraith APIs, Horizon/Soroban endpoints, Solana clusters, or CKB indexers fail.

| Error Class              | Stable Code                            | Context Fields                      | Description                                                               |
| :----------------------- | :------------------------------------- | :---------------------------------- | :------------------------------------------------------------------------ |
| `RPCRequestError`        | `"WRAITH/NETWORK/RPC_REQUEST"`         | `url`, `statusCode`, `responseText` | Thrown when an HTTP/RPC endpoint returns a non-2xx status code.           |
| `RPCRetryExhaustedError` | `"WRAITH/NETWORK/RPC_RETRY_EXHAUSTED"` | `url`, `attempts`, `lastError`      | Thrown when all query retry strategies have timed out or failed.          |
| `RetentionExceededError` | `"WRAITH/NETWORK/RETENTION_EXCEEDED"`  | `limit`, `actual`                   | Thrown when querying historical logs beyond maximum retention boundaries. |

### 4. Smart Contract Errors (`WraithContractError`)

Thrown when on-chain interactions or blockchain registries return errors.

| Error Class                  | Stable Code                                 | Context Fields       | Description                                                                   |
| :--------------------------- | :------------------------------------------ | :------------------- | :---------------------------------------------------------------------------- |
| `NameNotFoundError`          | `"WRAITH/CONTRACT/NAME_NOT_FOUND"`          | `name`               | Thrown when attempting to resolve a `.wraith` name that is not registered.    |
| `NameAlreadyRegisteredError` | `"WRAITH/CONTRACT/NAME_ALREADY_REGISTERED"` | `name`, `owner`      | Thrown when registering a name that is already owned.                         |
| `InsufficientAuthError`      | `"WRAITH/CONTRACT/INSUFFICIENT_AUTH"`       | `required`, `actual` | Thrown when a name update or release transaction is signed by a non-owner.    |
| `ContractRevertError`        | `"WRAITH/CONTRACT/CONTRACT_REVERT"`         | `reason`, `txHash`   | Thrown when a contract method call or transaction execution reverts on-chain. |

### 5. Transaction Builder Errors (`WraithBuilderError`)

Thrown during local transaction preparation before submission.

| Error Class                | Stable Code                             | Context Fields                | Description                                                                                |
| :------------------------- | :-------------------------------------- | :---------------------------- | :----------------------------------------------------------------------------------------- |
| `InsufficientBalanceError` | `"WRAITH/BUILDER/INSUFFICIENT_BALANCE"` | `required`, `actual`, `asset` | Thrown when the local wallet balance is insufficient to pay for private transfers or fees. |
| `UnsupportedAssetError`    | `"WRAITH/BUILDER/UNSUPPORTED_ASSET"`    | `asset`, `chain`              | Thrown when trying to build transactions for an asset or chain not supported by the SDK.   |

---

## Developer Code Examples

### 1. Granular Catch Block

```typescript
import { Wraith } from '@wraith-protocol/sdk';
import { NameNotFoundError, RPCRequestError } from '@wraith-protocol/sdk';

const wraith = new Wraith({ apiKey: 'wraith_prod_...' });

try {
  const agent = await wraith.getAgentByName('nonexistent.wraith');
} catch (error) {
  if (error instanceof NameNotFoundError) {
    console.error(`Please register "${error.context.name}" before proceeding.`);
  } else if (error instanceof RPCRequestError) {
    console.error(`API server returned an error: Code ${error.statusCode}`);
  } else {
    console.error('An unexpected error occurred:', error);
  }
}
```

### 2. Category-based Filtering

You can catch broader error classes if you only want to distinguish between validation, cryptographic, or network issues:

```typescript
import { WraithInputError, WraithNetworkError } from '@wraith-protocol/sdk';

try {
  // Key derivation or address validation
} catch (error) {
  if (error instanceof WraithInputError) {
    // Catch-all for InvalidMetaAddress, InvalidSignature, InvalidName, etc.
    alert('Please check your input parameters and try again.');
  } else if (error instanceof WraithNetworkError) {
    alert('Network connection problem. Please verify your connection.');
  }
}
```

### 3. Serialization to JSON

When passing errors between execution layers (e.g. returning an error from a serverless background worker to a web client), all custom fields are fully preserved:

```typescript
const error = new InvalidMetaAddressError('st:eth:invalid', 'wrong length');

console.log(JSON.stringify(error, null, 2));
```

**Output:**

```json
{
  "name": "InvalidMetaAddressError",
  "message": "Invalid stealth meta-address format: \"st:eth:invalid\". wrong length (See https://docs.wraith.dev/sdk/errors#invalid-meta-address)",
  "code": "WRAITH/INPUT/INVALID_META_ADDRESS",
  "docsLink": "https://docs.wraith.dev/sdk/errors#invalid-meta-address",
  "context": {
    "metaAddress": "st:eth:invalid",
    "reason": "wrong length"
  }
}
```
