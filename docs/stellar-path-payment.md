# Stellar Path Payments with Stealth

`buildPathStealthPayment` and `findStrictReceivePath` are helpers in `@wraith-protocol/sdk/chains/stellar` that enable senders to pay in one asset while receivers receive in another via on-the-fly conversion through Stellar's orderbook/AMM, integrated with the stealth send flow.

---

## Overview

Stellar path payments allow atomic asset conversion during payment. This implementation wraps Stellar's `pathPaymentStrictReceive` operation and integrates it with the stealth address generation and announcement flow, enabling:

- **Cross-asset stealth payments**: Send USDC, receive XLM (or any supported asset pair)
- **Path-finding via Horizon**: Automatically discovers optimal swap routes through orderbooks and AMMs
- **Slippage protection**: Set maximum send amount to avoid unfavorable execution
- **Atomic stealth announcement**: The recipient can detect the payment regardless of asset conversion

---

## Installation

```ts
npm install @wraith-protocol/sdk @stellar/stellar-sdk
```

---

## API

### buildPathStealthPayment

Builds a single atomic Stellar transaction that swaps assets, delivers to a stealth address, and announces the payment.

```ts
import { buildPathStealthPayment } from '@wraith-protocol/sdk/chains/stellar';

const { transaction, stealthResult } = buildPathStealthPayment(options);
```

#### Parameters

| Field | Type | Required | Description |
|---|---|---|---|
| `sender` | `string` | ✅ | Public key (G...) of the sender |
| `sequence` | `string` | ✅ | Current sequence number of the sender account |
| `sendAsset` | `Asset` | ✅ | Asset the sender is spending |
| `receiveAsset` | `Asset` | ✅ | Asset the stealth address should receive |
| `recipientMeta` | `string` | ✅ | Encoded stealth meta-address (`st:xlm:...`) |
| `sendMax` | `string` | ✅ | Maximum amount of `sendAsset` to spend (slippage protection) |
| `destAmount` | `string` | ✅ | Exact amount of `receiveAsset` the stealth address receives |
| `announcerContract` | `string` | ✅ | Address of the Wraith announcer contract |
| `networkPassphrase` | `string` | ✅ | Stellar network passphrase |
| `path` | `Asset[]` | ❌ | Intermediate assets for the swap route |
| `fee` | `string` | ❌ | Base fee in stroops (default: `"100"`) |
| `_ephemeralSeed` | `Uint8Array` | ❌ | Deterministic seed for testing only |

#### Return value

```ts
interface PathStealthPaymentResult {
  transaction: Transaction;  // Unsigned transaction to sign and submit
  stealthResult: GeneratedStealthAddress;  // Generated stealth account details
}
```

### findStrictReceivePath

Queries the Horizon `/paths/strict-receive` endpoint to find the optimal payment path and quoted cost.

```ts
import { findStrictReceivePath } from '@wraith-protocol/sdk/chains/stellar';

const { sourceAmount, path } = await findStrictReceivePath(options);
```

#### Parameters

| Field | Type | Required | Description |
|---|---|---|---|
| `sendAsset` | `Asset` | ✅ | Asset the sender is spending |
| `receiveAsset` | `Asset` | ✅ | Asset the stealth address should receive |
| `destAmount` | `string` | ✅ | Exact amount of `receiveAsset` desired |
| `horizonUrl` | `string` | ❌ | Custom Horizon URL (default: deployment's Horizon) |
| `chain` | `string` | ❌ | Chain deployment key (default: `"stellar"`) |

#### Return value

```ts
interface StrictReceivePathResult {
  sourceAmount: string;  // Quoted cost in sendAsset
  path: Asset[];         // Optimal intermediate assets for the swap
}
```

---

## Worked Examples

### 1 — Send USDC, receive XLM with path-finding

```ts
import { Asset, Keypair, Networks, Server } from '@stellar/stellar-sdk';
import { 
  buildPathStealthPayment, 
  findStrictReceivePath 
} from '@wraith-protocol/sdk/chains/stellar';

const USDC_TESTNET = new Asset(
  'USDC', 
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
);

// 1. Find the best path and quoted cost
const { sourceAmount, path } = await findStrictReceivePath({
  sendAsset: USDC_TESTNET,
  receiveAsset: Asset.native(),
  destAmount: '100',  // Want to receive 100 XLM
});

console.log(`Quoted cost: ${sourceAmount} USDC`);
console.log(`Path: ${path.map(a => a.code || 'XLM').join(' → ')}`);

// 2. Add slippage protection (0.5% tolerance)
const slippageBps = 50;  // 0.5%
const sendMax = (parseFloat(sourceAmount) * (1 + slippageBps / 10_000)).toFixed(7);

// 3. Build the stealth payment transaction
const senderKeypair = Keypair.fromSecret('S...');
const server = new Server('https://horizon-testnet.stellar.org');
const senderAccount = await server.loadAccount(senderKeypair.publicKey());

const { transaction, stealthResult } = buildPathStealthPayment({
  sender: senderKeypair.publicKey(),
  sequence: senderAccount.sequence(),
  sendAsset: USDC_TESTNET,
  receiveAsset: Asset.native(),
  destAmount: '100',
  sendMax,
  recipientMeta: 'st:xlm:...',  // Recipient's meta-address
  announcerContract: 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL',
  networkPassphrase: Networks.TESTNET,
  path,  // Use the path found by Horizon
});

// 4. Sign and submit
transaction.sign(senderKeypair);
const result = await server.submitTransaction(transaction);
console.log(`Payment sent: ${result.hash}`);
```

### 2 — Send XLM, receive custom asset (USDC)

```ts
const { sourceAmount, path } = await findStrictReceivePath({
  sendAsset: Asset.native(),
  receiveAsset: USDC_TESTNET,
  destAmount: '50',  // Receive 50 USDC
});

const sendMax = (parseFloat(sourceAmount) * 1.005).toFixed(7);  // 0.5% slippage

const { transaction } = buildPathStealthPayment({
  sender: senderKeypair.publicKey(),
  sequence: senderAccount.sequence(),
  sendAsset: Asset.native(),
  receiveAsset: USDC_TESTNET,
  destAmount: '50',
  sendMax,
  recipientMeta: 'st:xlm:...',
  announcerContract: 'CCJLJ...',
  networkPassphrase: Networks.TESTNET,
  path,
});

// For non-native receiveAsset, the transaction includes:
// 1. pathPaymentStrictReceive (swap to sender)
// 2. createClaimableBalance (wrap for stealth address)
// 3. invokeHostFunction (announce payment)
```

### 3 — Explicit path (no Horizon path-finding)

If you want to pin a specific swap route instead of letting Horizon find the best path:

```ts
const { transaction } = buildPathStealthPayment({
  sender: senderKeypair.publicKey(),
  sequence: senderAccount.sequence(),
  sendAsset: USDC_TESTNET,
  receiveAsset: Asset.native(),
  destAmount: '100',
  sendMax: '50.025',  // Manually calculated or quoted
  recipientMeta: 'st:xlm:...',
  announcerContract: 'CCJLJ...',
  networkPassphrase: Networks.TESTNET,
  path: [Asset.native()],  // Explicit path: USDC → XLM
});
```

### 4 — Same-asset payment (no conversion)

When `sendAsset === receiveAsset`, the path payment behaves like a regular payment:

```ts
const { transaction } = buildPathStealthPayment({
  sender: senderKeypair.publicKey(),
  sequence: senderAccount.sequence(),
  sendAsset: Asset.native(),
  receiveAsset: Asset.native(),
  destAmount: '100',
  sendMax: '100',  // No slippage needed for same asset
  recipientMeta: 'st:xlm:...',
  announcerContract: 'CCJLJ...',
  networkPassphrase: Networks.TESTNET,
});
```

---

## Slippage Protection

The `sendMax` parameter caps how much `sendAsset` the sender will spend. If the swap would cost more, Stellar rejects the transaction with `PATH_PAYMENT_TOO_FEW_OFFERS` before any funds move.

### Calculating sendMax with slippage tolerance

```ts
// Get quoted cost from Horizon
const { sourceAmount } = await findStrictReceivePath({
  sendAsset: USDC,
  receiveAsset: Asset.native(),
  destAmount: '100',
});

// Apply slippage tolerance (in basis points)
const slippageBps = 50;  // 0.5%
const sendMax = (parseFloat(sourceAmount) * (1 + slippageBps / 10_000)).toFixed(7);

// Example: if sourceAmount = 50.0 USDC
// sendMax = 50.0 * 1.005 = 50.25 USDC
```

Common slippage tolerances:
- **10 bps (0.1%)**: Very tight, may fail during volatility
- **50 bps (0.5%)**: Balanced for most use cases
- **100 bps (1.0%)**: Loose, maximizes success probability

---

## Asset Delivery Behavior

### Native XLM as receiveAsset

When `receiveAsset` is native XLM:
- `pathPaymentStrictReceive` delivers XLM directly to the stealth address
- If the stealth account doesn't exist, it's created atomically
- Transaction has 2 operations: swap + announcement

### Non-native receiveAsset (e.g., USDC)

When `receiveAsset` is a custom asset:
- `pathPaymentStrictReceive` delivers to the sender first
- A `createClaimableBalance` operation wraps the amount for the stealth address
- This bypasses the trustline requirement on a brand-new account
- Transaction has 3 operations: swap + claimable balance + announcement

The recipient can claim the balance once they detect the announcement and derive the stealth private key.

---

## Error Handling

### No payment path found

If Horizon cannot find a path for the asset pair and amount:

```ts
try {
  const { sourceAmount, path } = await findStrictReceivePath({
    sendAsset: USDC,
    receiveAsset: Asset.native(),
    destAmount: '1000000',  // Unrealistic amount
  });
} catch (error) {
  console.error('No payment path found:', error.message);
  // Fallback: ask user to adjust amount or try different asset pair
}
```

### Slippage exceeded

If the transaction fails due to slippage:

```ts
try {
  const result = await server.submitTransaction(transaction);
} catch (error) {
  if (error.response?.data?.extras?.result_codes?.operations?.[0] === 'op_no_trust') {
    console.error('No trustline for receiveAsset');
  } else if (error.response?.data?.extras?.result_codes?.operations?.[0] === 'op_underfunded') {
    console.error('Slippage exceeded - try increasing sendMax');
  }
}
```

---

## Running Tests

```bash
# Unit tests (no network needed)
pnpm test test/chains/stellar/path-payment.test.ts

# Integration tests against testnet (requires INTEGRATION=1)
INTEGRATION=1 pnpm exec vitest run test/chains/stellar/path-payment.integration.test.ts
```

---

## Comparison with buildStellarSwapAndStealth

The SDK provides two similar helpers:

| Feature | `buildPathStealthPayment` | `buildStellarSwapAndStealth` |
|---|---|---|
| **Primary use case** | General path payments with Horizon integration | Simplified swap + stealth (legacy) |
| **Path-finding** | Includes `findStrictReceivePath` helper | Manual path specification only |
| **Parameter names** | `sendAsset`, `receiveAsset` | `fromAsset`, `toAsset` |
| **Recommendation** | Use for new implementations | Existing code can continue using |

Both functions produce equivalent transactions; `buildPathStealthPayment` is the newer, more feature-rich API.
