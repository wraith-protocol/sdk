# Migration Guide

This guide documents breaking changes to `@wraith-protocol/sdk` and how to update your code.

## Upgrading to 2.0.0

### Error Handling: From Message Matching to Typed Exceptions (1.5.0+)

**Rationale:** The SDK now exports a hierarchy of typed error classes, allowing programmatic error handling without brittle `error.message` string matching. This change improves maintainability and enables richer error context like `expectedLength`, `actualLength`, `code`, and auto-generated `docsLink`.

**Before (1.4.x):**

```typescript
try {
  const sig = '0x...'; // Wrong length
  deriveStealthKeys(sig);
} catch (e) {
  if (e.message.includes('Expected 65-byte signature')) {
    console.log('Signature length mismatch');
  }
}
```

**After (1.5.0+):**

```typescript
import { InvalidSignatureError, KeyDerivationFailedError } from '@wraith-protocol/sdk';

try {
  const sig = '0x...'; // Wrong length
  deriveStealthKeys(sig);
} catch (e) {
  if (e instanceof InvalidSignatureError) {
    console.log(`Expected ${e.context.expectedLength}, got ${e.context.actualLength}`);
    console.log(`Docs: ${e.docsLink}`);
  } else if (e instanceof KeyDerivationFailedError) {
    console.log(`Key derivation failed: ${e.context.reason}`);
  }
}
```

**Affected Error Types:**

All cryptographic and network operations may now throw typed exceptions. Import and use these base or specific error classes:

- **Base classes:** `WraithError`, `WraithInputError`, `WraithCryptoError`, `WraithNetworkError`, `WraithContractError`, `WraithBuilderError`
- **Input validation:** `InvalidMetaAddressError`, `InvalidNameError`, `InvalidSignatureError`, `InvalidScalarError`
- **Cryptography:** `KeyDerivationFailedError`, `ViewTagMismatchError`, `ECDHFailedError`
- **Network:** `RPCRequestError`, `RPCRetryExhaustedError`, `RetentionExceededError`
- **Contracts:** `NameNotFoundError`, `NameAlreadyRegisteredError`, `InsufficientAuthError`, `ContractRevertError`
- **Builders:** `InsufficientBalanceError`, `UnsupportedAssetError`

All are exported from the SDK root:

```typescript
import {
  WraithError,
  InvalidMetaAddressError,
  // ... other error types
} from '@wraith-protocol/sdk';
```

---

### Stellar: Cryptographic Audit Fixes (1.5.0+)

**Rationale:** The independent cryptographic audit of the Stellar chain module identified two medium-severity findings in scalar handling that required immediate fixes:

1. **Zero-scalar rejection**: Derived scalars must never be zero (security constraint).
2. **Signature verification**: Stellar transaction signatures must be verified with the correct public key.

These fixes are cryptographically **sound** but **behaviorally breaking** if your code relied on edge-case scalars.

#### Change 1: `scanAnnouncements()` Now Skips Zero-Scalar Candidates

**Before (1.4.x):**

```typescript
import { scanAnnouncements } from '@wraith-protocol/sdk/chains/stellar';

const matched = scanAnnouncements(announcements, viewingKey, spendingPubKey, spendingScalar);
// All announcements with matching view tags were included, even if (spendingScalar + hashScalar) % L === 0
```

**After (1.5.0+):**

```typescript
import { scanAnnouncements } from '@wraith-protocol/sdk/chains/stellar';

const matched = scanAnnouncements(announcements, viewingKey, spendingPubKey, spendingScalar);
// Announcements that would result in stealthPrivateScalar <= 0 are silently skipped
// This is extremely rare (probability ~1 in 2^255) but now cryptographically correct
```

**Migration:** No code change required unless you were explicitly handling or testing zero-scalar edge cases. If you have test fixtures that generate announcements with zero-scalar outcomes, regenerate them.

#### Change 2: `checkStealthAddress()` View-Tag Computation Optimized

**Before (1.4.x):**

```typescript
const result = checkStealthAddress(ephemeralPubKey, viewingKey, spendingPubKey, viewTag);
// View tag was computed from shared secret derived from (viewingKey ECDH ephemeralPubKey)
```

**After (1.5.0+):**

```typescript
const result = checkStealthAddress(ephemeralPubKey, viewingKey, spendingPubKey, viewTag);
// View tag is now computed from the ephemeralPubKey and viewingPubKey directly (prefilter optimization)
// Functionally identical, but 1.5–2x faster for large announcement batches
```

**Migration:** No code change required. The function signature is identical; only the internal computation is optimized. Existing callers and test vectors remain valid.

---

### React Native: Explicit Polyfill Installation Required (1.5.0+)

**Rationale:** React Native environments lack native `crypto` APIs and WebAssembly support. The SDK now provides opt-in polyfills instead of automatically patching globals, which avoids surprising bundlers and test environments.

**Before (1.4.x):**

```typescript
// On React Native, crypto functions "just worked" because the SDK automatically
// installed polyfills when imported. This surprised some bundlers.
import { scanAnnouncements } from '@wraith-protocol/sdk/chains/stellar';
const matched = scanAnnouncements(...);
```

**After (1.5.0+):**

```typescript
// React Native apps MUST call this once at app startup
import { installReactNativePolyfills } from '@wraith-protocol/sdk';
installReactNativePolyfills();

// Now use the SDK normally
import { scanAnnouncements } from '@wraith-protocol/sdk/chains/stellar';
const matched = scanAnnouncements(...);
```

**Where to Call:**

Add the polyfill installation **early** in your app entry point (before any crypto imports):

**Expo + TypeScript:**

```typescript
// App.tsx
import { installReactNativePolyfills } from '@wraith-protocol/sdk';

// Call this once at app start, before importing Stellar/Solana modules
installReactNativePolyfills();

export default function App() {
  // ... your app
}
```

**React Native (Bare Workflow):**

```typescript
// index.ts (or index.js)
import { installReactNativePolyfills } from '@wraith-protocol/sdk';

installReactNativePolyfills();

import { AppRegistry } from 'react-native';
import App from './App';

AppRegistry.registerComponent('MyApp', () => App);
```

**If Not Using React Native:**

No change needed. The polyfill function is a no-op in Node.js and browser environments.

---

### Scanner Pool API

The SDK now includes a `ScannerPool` utility for efficient multichain scanning. While this is an **additive feature** (no breaking changes), be aware of the new export:

```typescript
import { ScannerPool } from '@wraith-protocol/sdk';

// Scan multiple chains in parallel with bounded concurrency
const pool = new ScannerPool({ concurrency: 4 });

const results = await pool.scan([
  {
    chain: 'ethereum',
    announcements,
    viewingKey,
    spendingPubKey,
    spendingScalar,
  },
  {
    chain: 'stellar',
    announcements,
    viewingKey,
    spendingPubKey,
    spendingScalar,
  },
]);
```

This is fully backward-compatible; existing code using individual chain scan functions continues to work.

---

## Error Reference

For detailed documentation on each error type, including context fields and resolution steps, see [docs/errors.md](./docs/errors.md).

### Common Errors and Fixes

**`InvalidMetaAddressError`**

```typescript
import { InvalidMetaAddressError } from '@wraith-protocol/sdk';

try {
  const decoded = decodeStealthMetaAddress('invalid-format');
} catch (e) {
  if (e instanceof InvalidMetaAddressError) {
    console.log(`Invalid meta-address: ${e.context.metaAddress}`);
    console.log(`Reason: ${e.context.reason}`);
    // Check prefix ('st:eth:', 'st:xlm:', etc.) and total length
  }
}
```

**`InvalidSignatureError`**

```typescript
import { InvalidSignatureError } from '@wraith-protocol/sdk';

try {
  const keys = deriveStealthKeys(signature);
} catch (e) {
  if (e instanceof InvalidSignatureError) {
    console.log(`Expected: ${e.context.expectedLength} bytes`);
    console.log(`Got: ${e.context.actualLength} bytes`);
    // Ensure signature is exactly 65 bytes (EVM) or 64 bytes (Stellar)
  }
}
```

**`KeyDerivationFailedError`**

```typescript
import { KeyDerivationFailedError } from '@wraith-protocol/sdk';

try {
  const keys = deriveStealthKeys(signature);
} catch (e) {
  if (e instanceof KeyDerivationFailedError) {
    console.log(`Key derivation failed: ${e.context.reason}`);
    // Usually means signature format is invalid or cryptographic operation failed
  }
}
```

---

## Testing Migration

If you have tests that mock errors or check error messages:

**Before:**

```typescript
test('rejects invalid signature', async () => {
  expect(() => deriveStealthKeys('0x...')).toThrow(/Expected 65-byte signature/);
});
```

**After:**

```typescript
import { InvalidSignatureError } from '@wraith-protocol/sdk';

test('rejects invalid signature', async () => {
  expect(() => deriveStealthKeys('0x...')).toThrow(InvalidSignatureError);
});
```

---

## Getting Help

- **Error Documentation:** https://docs.wraith.dev/sdk/errors
- **GitHub Issues:** https://github.com/wraith-protocol/sdk/issues
- **Contributing:** See [CONTRIBUTING.md](./CONTRIBUTING.md) for the semver policy and deprecation rules.
