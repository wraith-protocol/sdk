# Stellar Memos

`encodeMemo`, `decodeMemo`, and `extractMemoFromTransaction` are typed helpers in `@wraith-protocol/sdk/chains/stellar` for working with Stellar transaction memos. They provide validation, type safety, and convenient extraction patterns.

---

## Overview

Stellar transactions can include memos to attach arbitrary data. The SDK supports all memo types:

- **None**: No memo (default)
- **ID**: A 64-bit unsigned integer
- **Text**: A UTF-8 string (max 28 bytes)
- **Hash**: A 32-byte hash (hex-encoded or Uint8Array)
- **Return**: A 32-byte hash for return memos (hex-encoded or Uint8Array)

These helpers validate memo values and provide a consistent typed interface.

---

## Installation

```ts
npm install @wraith-protocol/sdk @stellar/stellar-sdk
```

---

## API

### encodeMemo

Encodes a typed memo into a Stellar SDK Memo object with validation.

```ts
import { encodeMemo } from '@wraith-protocol/sdk/chains/stellar';

const memo = encodeMemo({ type: 'text', value: 'Payment #123' });
```

#### Parameters

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `'none' \| 'id' \| 'text' \| 'hash' \| 'return'` | ✅ | The memo type |
| `value` | `string \| Uint8Array \| null` | ✅ | The memo value (null for 'none') |

#### Return value

Returns a Stellar SDK `Memo` object.

#### Validation

- **Text memos**: Must be ≤ 28 bytes (UTF-8 encoded)
- **ID memos**: Must be a valid uint64 string (0 to 2^64-1)
- **Hash/Return memos**: Must be exactly 32 bytes

#### Throws

Throws `MemoValidationError` if validation fails.

### decodeMemo

Decodes a Stellar SDK Memo object into a typed structure.

```ts
import { decodeMemo } from '@wraith-protocol/sdk/chains/stellar';

const typed = decodeMemo(memo);
// => { type: 'text', value: 'Payment #123' }
```

#### Parameters

| Field | Type | Required | Description |
|---|---|---|---|
| `memo` | `Memo \| xdr.Memo` | ✅ | The Stellar SDK Memo object |

#### Return value

```ts
interface TypedMemo {
  type: MemoType;
  value: MemoValue;
}
```

### extractMemoFromTransaction

Extracts the memo from a Stellar transaction and returns a typed structure.

```ts
import { extractMemoFromTransaction } from '@wraith-protocol/sdk/chains/stellar';

const memo = extractMemoFromTransaction(transaction);
```

#### Parameters

| Field | Type | Required | Description |
|---|---|---|---|
| `tx` | `{ memo: Memo \| xdr.Memo }` | ✅ | The Stellar transaction object |

#### Return value

Returns a `TypedMemo` structure.

---

## Worked Examples

### 1 — Text memo for payment reference

```ts
import { encodeMemo } from '@wraith-protocol/sdk/chains/stellar';
import { TransactionBuilder, Networks, Operation } from '@stellar/stellar-sdk';

const tx = new TransactionBuilder(sourceAccount, {
  fee: '100',
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(Operation.payment({
    destination: 'GHIJKLMNOPQRSTUVWXYZ1234567890',
    asset: Operation.paymentAssetToXDR('native'),
    amount: '100',
  }))
  .addMemo(encodeMemo({ type: 'text', value: 'Invoice #12345' }))
  .setTimeout(30)
  .build();
```

### 2 — ID memo for numeric reference

```ts
const tx = new TransactionBuilder(sourceAccount, {
  fee: '100',
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(Operation.payment({
    destination: 'GHIJKLMNOPQRSTUVWXYZ1234567890',
    asset: Operation.paymentAssetToXDR('native'),
    amount: '100',
  }))
  .addMemo(encodeMemo({ type: 'id', value: '99999' }))
  .setTimeout(30)
  .build();
```

### 3 — Hash memo for external reference

```ts
import { encodeMemo } from '@wraith-protocol/sdk/chains/stellar';

// From hex string
const hashValue = 'a'.repeat(64); // 32 bytes in hex
const memo = encodeMemo({ type: 'hash', value: hashValue });

// From Uint8Array
const hashBytes = new Uint8Array(32).fill(0xaa);
const memo2 = encodeMemo({ type: 'hash', value: hashBytes });
```

### 4 — Decoding memos from transactions

```ts
import { decodeMemo, extractMemoFromTransaction } from '@wraith-protocol/sdk/chains/stellar';

// Decode a Memo object directly
const memo = Memo.text('Payment #123');
const typed = decodeMemo(memo);
console.log(typed.type);  // 'text'
console.log(typed.value); // 'Payment #123'

// Extract from a transaction
const txMemo = extractMemoFromTransaction(transaction);
console.log(txMemo.type);  // 'text'
console.log(txMemo.value); // 'Payment #123'
```

### 5 — Displaying memos in UI

```ts
import { extractMemoFromTransaction } from '@wraith-protocol/sdk/chains/stellar';

function formatMemoForDisplay(tx: any): string {
  const memo = extractMemoFromTransaction(tx);
  
  switch (memo.type) {
    case 'none':
      return 'No memo';
    case 'id':
      return `ID: ${memo.value}`;
    case 'text':
      return memo.value as string;
    case 'hash':
    case 'return':
      return Buffer.from(memo.value as Uint8Array).toString('hex');
    default:
      return 'Unknown memo type';
  }
}
```

### 6 — Validation error handling

```ts
import { encodeMemo, MemoValidationError } from '@wraith-protocol/sdk/chains/stellar';

try {
  const memo = encodeMemo({ type: 'text', value: 'a'.repeat(29) });
} catch (error) {
  if (error instanceof MemoValidationError) {
    console.error('Memo validation failed:', error.message);
    // "Text memo must be at most 28 bytes, got 29 bytes"
  }
}
```

---

## Validation Rules

### Text Memos

- Maximum 28 bytes (UTF-8 encoded)
- Multi-byte characters count toward the limit
- Example: "😀" is 4 bytes, so 7 emojis = 28 bytes (valid), 8 emojis = 32 bytes (invalid)

### ID Memos

- Must be a valid uint64 string
- Range: 0 to 18,446,744,073,709,551,615 (2^64 - 1)
- Negative values are invalid
- Non-numeric strings are invalid

### Hash/Return Memos

- Must be exactly 32 bytes
- Can be provided as hex string (64 hex characters) or Uint8Array
- Invalid hex strings will throw an error

---

## Constants

The SDK exports memo validation constants:

```ts
import { 
  TEXT_MEMO_MAX_BYTES, 
  HASH_MEMO_BYTES, 
  ID_MEMO_MAX 
} from '@wraith-protocol/sdk/chains/stellar';

console.log(TEXT_MEMO_MAX_BYTES); // 28
console.log(HASH_MEMO_BYTES);      // 32
console.log(ID_MEMO_MAX);          // 18446744073709551615n
```

---

## Error Types

### MemoValidationError

Thrown when memo validation fails.

```ts
class MemoValidationError extends Error {
  constructor(message: string);
}
```

Common error messages:
- `"Text memo must be at most 28 bytes, got X bytes"`
- `"ID memo value must be a valid uint64 string, got X"`
- `"Hash memo must be exactly 32 bytes, got X bytes"`
- `"X memo requires a value"`

---

## Running Tests

```bash
# Unit tests (no network needed)
pnpm test test/chains/stellar/memo.test.ts
```

---

## Best Practices

### 1 — Use text memos for human-readable references

Text memos are ideal for invoice numbers, payment references, or short identifiers that users might need to read.

```ts
encodeMemo({ type: 'text', value: 'INV-2024-001' });
```

### 2 — Use ID memos for numeric database references

If you have a numeric ID from your database, use the ID memo type for efficient storage.

```ts
encodeMemo({ type: 'id', value: orderId.toString() });
```

### 3 — Use hash memos for external references

When referencing external systems (e.g., transaction hashes from other blockchains), use hash memos.

```ts
encodeMemo({ type: 'hash', value: externalTxHash });
```

### 4 — Always validate user input

When accepting memo values from users, validate them before encoding:

```ts
function safeEncodeTextMemo(value: string): Memo {
  if (new TextEncoder().encode(value).length > 28) {
    throw new Error('Memo too long');
  }
  return encodeMemo({ type: 'text', value });
}
```

### 5 — Handle none memos gracefully

Always check for none memos when displaying transaction details:

```ts
const memo = extractMemoFromTransaction(tx);
if (memo.type !== 'none') {
  // Display memo
}
```

---

## Comparison with Stellar SDK Primitives

| Feature | Stellar SDK | Wraith SDK |
|---|---|---|---|
| **Type safety** | Untyped | Typed `TypedMemo` interface |
| **Validation** | Manual | Built-in with clear errors |
| **Extraction** | Manual access to `tx.memo` | `extractMemoFromTransaction()` helper |
| **Decoding** | Manual switch on `memo.switch()` | `decodeMemo()` helper |
| **Error handling** | Runtime errors | `MemoValidationError` with messages |

The Wraith SDK helpers provide a more ergonomic and safer interface for working with memos.
