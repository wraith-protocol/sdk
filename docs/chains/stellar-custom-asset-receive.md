# Stellar custom-asset receive helpers

## Background

Stellar's trust model requires an account to explicitly opt in to holding an issued asset
by submitting a `changeTrust` operation before any balance of that asset can be received.
A freshly generated stealth address will not have this trustline, which would cause a direct
payment to fail.

PR #32 handled the **send** side by wrapping issued-asset payments in a `createClaimableBalance`
so the sender can deposit funds regardless of whether the stealth account has a trustline.
These helpers handle the **receive** side: detecting whether the stealth account is ready and
building the claim transaction that withdraws the balance.

## API

### `prepareStealthAccountForAsset`

```ts
import { prepareStealthAccountForAsset } from '@wraith-protocol/sdk/chains/stellar';
import type { AssetReceivabilityResult } from '@wraith-protocol/sdk/chains/stellar';

const result: AssetReceivabilityResult = prepareStealthAccountForAsset(
  stealthAccount.balances, // from Horizon loadAccount()
  issuerAccount.flags, // from Horizon loadAccount() on the issuer
  asset,
);
```

Returns an `AssetReceivabilityResult`:

| Field                | Type                                         | Meaning                                                                                        |
| -------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `hasTrustline`       | `boolean`                                    | `true` if the account already holds a trustline for the asset.                                 |
| `issuerAuthRequired` | `boolean`                                    | `true` if the issuer has `AUTH_REQUIRED` set on their account flags.                           |
| `ops`                | `ReturnType<typeof Operation.changeTrust>[]` | Operations to submit before the account can receive the asset. Empty when no action is needed. |

For native XLM, `hasTrustline` is always `true` and `ops` is always empty.

When `issuerAuthRequired` is `true` the helper still emits the `changeTrust` op (the account
must still establish the trustline), but the caller must also arrange explicit authorisation
from the issuer before any balance can be transferred.

### `buildWithdrawCustomAsset`

```ts
import { buildWithdrawCustomAsset } from '@wraith-protocol/sdk/chains/stellar';

const tx = buildWithdrawCustomAsset({
  stealthAddress: match.stealthAddress,
  sequence: stealthAccount.sequence,
  balanceId, // hex ID from createClaimableBalance
  asset,
  needsTrustline: !result.hasTrustline, // prepend changeTrust atomically
  networkPassphrase: Networks.TESTNET,
});
```

When `needsTrustline` is `true` the transaction prepends a `changeTrust` operation before
`claimClaimableBalance`, so both execute atomically — the trustline is established and the
balance is claimed in a single submission. If the transaction fails for any reason, neither
operation is applied.

## Full receive flow

```ts
import {
  prepareStealthAccountForAsset,
  buildWithdrawCustomAsset,
  signStellarTransaction,
} from '@wraith-protocol/sdk/chains/stellar';
import { Horizon, Networks } from '@stellar/stellar-sdk';

const horizonServer = new Horizon.Server('https://horizon-testnet.stellar.org');

// 1. Load the stealth account and issuer account from Horizon
const stealthAccount = await horizonServer.loadAccount(match.stealthAddress);
const issuerAccount = await horizonServer.loadAccount(asset.getIssuer());

// 2. Check trustline state and warn if issuer requires auth
const result = prepareStealthAccountForAsset(stealthAccount.balances, issuerAccount.flags, asset);

if (result.issuerAuthRequired) {
  console.warn(
    'Issuer requires explicit trustline authorisation. ' +
      'Contact the asset issuer to authorise this account before claiming.',
  );
}

// 3. Build the claim transaction
const tx = buildWithdrawCustomAsset({
  stealthAddress: match.stealthAddress,
  sequence: stealthAccount.sequence,
  balanceId,
  asset,
  needsTrustline: !result.hasTrustline,
  networkPassphrase: Networks.TESTNET,
});

// 4. Sign with the stealth scalar (not a seed — use signStellarTransaction)
const sig = signStellarTransaction(tx.hash(), match.stealthPrivateScalar, match.stealthPubKeyBytes);
tx.addDecoratedSignature(
  new xdr.DecoratedSignature({
    hint: Buffer.from(match.stealthPubKeyBytes.slice(28)),
    signature: Buffer.from(sig),
  }),
);

// 5. Submit
await horizonServer.submitTransaction(tx);
```

## `AUTH_REQUIRED` assets

When an issuer sets `AUTH_REQUIRED`, every trustline must be individually approved.
`prepareStealthAccountForAsset` sets `issuerAuthRequired: true` and still includes a
`changeTrust` op. The typical flow is:

1. Stealth account submits the `changeTrust` operation.
2. Caller contacts the issuer (or issues an `allowTrust` / `setTrustLineFlags` through
   their admin tooling) to authorise the trustline.
3. After authorisation, the stealth account calls `buildWithdrawCustomAsset` with
   `needsTrustline: false` (the trustline is now established) to claim the balance.
