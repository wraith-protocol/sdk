# Stellar Fee Estimation

`estimateStellarFee` is a helper in `@wraith-protocol/sdk/chains/stellar` that gives stealth payment senders a **low / expected / high** fee range before submitting a transaction. This avoids under-paying (rejected) or over-paying (wastes XLM).

---

## Why fees are hard to predict

Stellar has two fee components:

| Component | Applies to | Source |
|---|---|---|
| **Inclusion fee** (base fee × op count) | All transactions | Horizon `/fee_stats` → recent ledger p50/p99 |
| **Resource fee** | Soroban (smart contract) only | `simulateTransaction` RPC call |

The inclusion fee is set by network congestion — it can spike between the time you estimate and submit. The resource fee reflects ledger state at simulation time and may drift before submission.

---

## Installation

```ts
npm install @wraith-protocol/sdk @stellar/stellar-sdk
```

---

## API

```ts
import { estimateStellarFee } from '@wraith-protocol/sdk/chains/stellar';

const estimate = await estimateStellarFee(params);
// => { low: number, expected: number, high: number, breakdown: FeeBreakdown }
```

All fee values are in **stroops** (1 XLM = 10,000,000 stroops).

### Parameters

| Field | Type | Required | Description |
|---|---|---|---|
| `operationCount` | `number` | ✅ | Number of operations in the transaction |
| `sorobanResources` | `SorobanResources` | ❌ | Provide for Soroban invocations |
| `sorobanResources.transactionXdr` | `string` | ✅ (Soroban) | Serialised transaction XDR to simulate |
| `sorobanResources.simulationResult` | `SimulateTransactionResponse` | ❌ | Pre-fetched simulation (skips RPC call) |
| `network` | `'mainnet' \| 'testnet'` | ❌ | Defaults to `'testnet'` |
| `feeStats` | `Horizon.FeeStatsResponse` | ❌ | Pre-fetched fee stats (skips Horizon call) |
| `feeBump` | `boolean` | ❌ | Set `true` when wrapping in a fee-bump envelope |
| `rpcUrl` | `string` | ❌ | Custom Soroban RPC URL |
| `horizonUrl` | `string` | ❌ | Custom Horizon URL |

### Return value

```ts
interface FeeEstimate {
  low: number;      // Protocol minimum — likely rejected under congestion
  expected: number; // p50 fee rate — good for non-urgent transactions
  high: number;     // p99 × 2× surge buffer — maximises inclusion probability
  breakdown: {
    networkBaseFee: number;
    operationCount: number;
    feeBumpApplied: boolean;
    p50Fee?: number;
    p99Fee?: number;
    sorobanResourceFee?: number; // Soroban only
    sorobanPadding?: number;     // 25% padding on resource fee for "high" tier
    uncertainty: string;
  };
}
```

---

## Worked Examples

### 1 — Classic single-op payment

```ts
import { estimateStellarFee } from '@wraith-protocol/sdk/chains/stellar';
import { TransactionBuilder, Networks, Operation, Asset } from '@stellar/stellar-sdk';

const estimate = await estimateStellarFee({
  operationCount: 1,
  network: 'mainnet',
});

console.log(estimate);
// { low: 100, expected: 300, high: 10000, breakdown: { ... } }

// Use estimate.expected when building your transaction
const tx = new TransactionBuilder(sourceAccount, {
  fee: estimate.expected.toString(),
  networkPassphrase: Networks.PUBLIC,
})
  .addOperation(Operation.payment({ ... }))
  .setTimeout(30)
  .build();
```

### 2 — Multi-op transaction

```ts
const estimate = await estimateStellarFee({
  operationCount: 2,
  network: 'mainnet',
});

// low = 100 × 2 = 200 stroops
// expected = p50 × 2
// high = p99 × 2× × 2
```

### 3 — Soroban smart contract invocation

```ts
import { Contract, TransactionBuilder, Networks } from '@stellar/stellar-sdk';

// Build the transaction first (don't submit yet)
const contract = new Contract('CABC...XYZ');
const tx = new TransactionBuilder(sourceAccount, {
  fee: '100',
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(contract.call('send_stealth', /* args */))
  .setTimeout(30)
  .build();

// Estimate fee — simulateTransaction is called internally
const estimate = await estimateStellarFee({
  operationCount: 1,
  network: 'testnet',
  sorobanResources: {
    transactionXdr: tx.toXDR(),
  },
});

// { low: 5100, expected: 5300, high: 16250, breakdown: { sorobanResourceFee: 5000, sorobanPadding: 1250 } }
```

### 4 — Reusing a pre-fetched simulation

```ts
// If you already have a simulation result, pass it directly to avoid a second RPC call
const simResult = await server.simulateTransaction(tx);

const estimate = await estimateStellarFee({
  operationCount: 1,
  network: 'testnet',
  sorobanResources: {
    transactionXdr: tx.toXDR(),
    simulationResult: simResult,
  },
});
```

### 5 — Fee-bump transaction

```ts
const estimate = await estimateStellarFee({
  operationCount: 2,   // ops in the INNER transaction
  network: 'mainnet',
  feeBump: true,       // adds 1 for the outer envelope
});

// breakdown.operationCount === 3
// breakdown.feeBumpApplied === true

const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
  feeSource,
  estimate.expected.toString(),
  innerTx,
  Networks.PUBLIC,
);
```

### 6 — Surfacing estimates in Send / Withdraw UI

```ts
async function getFeeOptions(txXdr: string) {
  const estimate = await estimateStellarFee({
    operationCount: 1,
    network: 'mainnet',
    sorobanResources: { transactionXdr: txXdr },
  });

  const toXlm = (stroops: number) => (stroops / 10_000_000).toFixed(7);

  return [
    { label: 'Slow',     fee: estimate.low,      display: toXlm(estimate.low) },
    { label: 'Normal',   fee: estimate.expected,  display: toXlm(estimate.expected) },
    { label: 'Priority', fee: estimate.high,      display: toXlm(estimate.high) },
  ];
}
```

---

## Uncertainty & Caveats

The `breakdown.uncertainty` field always contains a plain-English explanation. Key points:

- **Classic fees** use `fee_charged.p50` and `fee_charged.p99` from Horizon `/fee_stats`. These reflect what transactions actually paid in recent ledgers. Congestion can push fees beyond p99 during spikes — use `high` for urgent sends.

- **Soroban resource fees** come from `simulateTransaction`. If ledger state changes between simulation and submission, the resource fee may differ. The `high` tier adds **25% padding** to mitigate this.

- **Fee-bump** adds one base-fee unit for the outer envelope per CAP-0015, already factored into `breakdown.operationCount`.

- **Estimates go stale.** For time-sensitive sends, refresh within the last few ledgers before building. Ledgers close every ~5 seconds.

---

## Running Tests

```bash
# Unit tests (no network needed)
pnpm test

# Integration tests against testnet
$env:INTEGRATION="1"; pnpm exec vitest run test/chains/stellar/fee-estimation.integration.test.ts
```