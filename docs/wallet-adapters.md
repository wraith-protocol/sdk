# Wallet Adapters: Errors, Events and Network Checks

The SDK ships three reference wallet adapters: `ViemWalletAdapter` (EVM),
`SolanaWalletAdapter` (`@solana/wallet-adapter`) and `FreighterWalletAdapter`
(Stellar). Each exposes `signMessage()` and `getAddress()`, which is all
`deriveStealthKeysFromWallet()` needs.

The wallets behind them report the same problems in different ways. A user who
declines a signature produces EIP-1193 code `4001` through viem, a
`WalletSignMessageError` wrapping `4001` through Phantom, and a
`{ code: -4 }` result from Freighter. This guide covers the tools that make
them look the same:

- a shared error taxonomy, `WraithWalletError`, and `normalizeWalletError()` to map provider errors onto it
- `watchWalletEvents()`, which reports account, network and disconnect changes in one shape
- `getNetwork()` and `assertWalletNetwork()` for wrong-network checks
- a reference of how each adapter behaves, covered by `test/wallet/conformance.test.ts`

Everything here is opt-in. The adapters' `signMessage()` and `getAddress()`
still throw the same errors they always have.

---

## Quick Start

```ts
import {
  createViemWalletAdapter,
  deriveStealthKeysFromWallet,
  withNormalizedWalletErrors,
  WalletNotConnectedError,
  WalletUnavailableError,
  WalletUserRejectedError,
  WalletWrongNetworkError,
} from '@wraith-protocol/sdk';

const wallet = withNormalizedWalletErrors(createViemWalletAdapter(walletClient));

try {
  const keys = await deriveStealthKeysFromWallet(wallet);
} catch (error) {
  if (error instanceof WalletUserRejectedError) {
    // The user cancelled. Offer a "Try again" button; don't retry automatically.
  } else if (error instanceof WalletNotConnectedError) {
    // Show "Connect wallet".
  } else if (error instanceof WalletWrongNetworkError) {
    // Ask the user to switch networks.
  } else if (error instanceof WalletUnavailableError) {
    // Link to the wallet's install page, or suggest another wallet.
  } else {
    throw error; // e.g. InvalidSignatureError from key derivation
  }
}
```

`withNormalizedWalletErrors()` only converts errors thrown by the wallet.
Errors from key derivation, such as `InvalidSignatureError`, pass through
unchanged.

---

## The Wallet Error Taxonomy

All wallet errors extend `WraithWalletError`, which extends `WraithError`, so
`code`, `context`, `docsLink`, `toJSON()` and `describe()` work as described in
[errors.md](./errors.md).

| Error Class                | Stable Code                      | Meaning                                                                                                                 |
| :------------------------- | :------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| `WalletNotConnectedError`  | `"WRAITH/WALLET/NOT_CONNECTED"`  | The wallet is not connected, is locked, has not authorised this site, or disconnected.                                  |
| `WalletUserRejectedError`  | `"WRAITH/WALLET/USER_REJECTED"`  | The user declined the request or closed the wallet window.                                                              |
| `WalletWrongNetworkError`  | `"WRAITH/WALLET/WRONG_NETWORK"`  | The wallet is on a different network than the request needs, or does not know the requested chain.                      |
| `WalletUnavailableError`   | `"WRAITH/WALLET/UNAVAILABLE"`    | No usable wallet: not installed, not ready in this environment, or unable to do what was asked (such as sign messages). |
| `WalletRequestFailedError` | `"WRAITH/WALLET/REQUEST_FAILED"` | Anything else the wallet reported. The provider's code and message are kept so you can inspect them.                    |

Every wallet error's `context` holds:

- `chain`: `'evm'`, `'solana'` or `'stellar'`, when known
- `reason`: the provider's message, or the SDK's when the SDK found the problem
- `providerCode`: the provider's code (such as `4001` or `-4`) or error name (such as `'WalletNotReadyError'`)
- `expectedNetwork` and `actualNetwork`, on `WalletWrongNetworkError`

The original provider error is available as `error.cause`. It is not included
in `toJSON()`, because provider errors are not always serialisable.

---

## Normalising Errors

### Wrap an Adapter

```ts
const stellar = withNormalizedWalletErrors(new FreighterWalletAdapter(freighter));
```

The wrapper returns a new adapter whose `signMessage()`, `getAddress()` and,
when the adapter has one, `getNetwork()` reject with `WraithWalletError`s. The
adapter you passed in is not modified.

### Normalise a Caught Error

Use `normalizeWalletError(error, chain?)` for wallet calls you make yourself,
such as a "Connect" button:

```ts
import { normalizeWalletError } from '@wraith-protocol/sdk';

// viem
await walletClient.requestAddresses().catch((e) => {
  throw normalizeWalletError(e, 'evm');
});

// @solana/wallet-adapter
await adapter.connect().catch((e) => {
  throw normalizeWalletError(e, 'solana');
});

// Freighter returns errors instead of throwing them
const { error } = await requestAccess();
if (error) throw normalizeWalletError(error, 'stellar');
```

`normalizeWalletError()` always returns a `WraithWalletError`. It checks the
error, then its `cause` chain and the `error` field that Solana wallet-adapter
uses to hold the wallet's own error. If it finds a `WraithWalletError` along
the way it returns that error unchanged, so normalising twice is safe.

### How Provider Errors Map

**viem and EIP-1193 wallets**

| Provider error                                                                        | Wraith error              |
| :------------------------------------------------------------------------------------ | :------------------------ |
| `4001` User Rejected Request (viem `UserRejectedRequestError`)                        | `WalletUserRejectedError` |
| `5000` CAIP-25 user rejection (WalletConnect)                                         | `WalletUserRejectedError` |
| `4100` Unauthorized (viem `UnauthorizedProviderError`)                                | `WalletNotConnectedError` |
| `4900` Disconnected (viem `ProviderDisconnectedError`)                                | `WalletNotConnectedError` |
| viem `AccountNotFoundError` (signing with no account)                                 | `WalletNotConnectedError` |
| `4901` Chain Disconnected (viem `ChainDisconnectedError`)                             | `WalletWrongNetworkError` |
| `4902` unrecognised chain from `wallet_switchEthereumChain` (viem `SwitchChainError`) | `WalletWrongNetworkError` |
| `5710` unsupported chain ID (viem `UnsupportedChainIdError`)                          | `WalletWrongNetworkError` |
| viem `ChainMismatchError`                                                             | `WalletWrongNetworkError` |
| `4200` Unsupported Method (viem `UnsupportedProviderMethodError`)                     | `WalletUnavailableError`  |

`4901` means the wallet is connected, but not to the chain the request needs,
so it maps to a wrong network rather than a disconnect.

**`@solana/wallet-adapter`**

| Provider error                                                       | Wraith error                               |
| :------------------------------------------------------------------- | :----------------------------------------- |
| `WalletNotConnectedError`, `WalletDisconnectedError`                 | `WalletNotConnectedError`                  |
| `WalletNotSelectedError` (`@solana/wallet-adapter-react`)            | `WalletNotConnectedError`                  |
| `WalletNotReadyError` (wallet not installed or loadable)             | `WalletUnavailableError`                   |
| `WalletWindowClosedError`                                            | `WalletUserRejectedError`                  |
| `WalletSignMessageError`, `WalletConnectionError` and other wrappers | Mapped from the wallet's error in `.error` |

Phantom reports `4001`, `4100` and `4900` with the same meanings as EIP-1193,
so a declined Phantom signature (a `WalletSignMessageError` wrapping `4001`)
becomes `WalletUserRejectedError`.

**Freighter (`@stellar/freighter-api` 3 and later)**

| Provider result                                                                                | Wraith error               |
| :--------------------------------------------------------------------------------------------- | :------------------------- |
| `{ code: -4, message: 'The user rejected this request.' }`, also sent when the popup is closed | `WalletUserRejectedError`  |
| `{ code: -1, message: 'Node environment is not supported' }`                                   | `WalletUnavailableError`   |
| Empty address (the site has no access)                                                         | `WalletNotConnectedError`  |
| `{ code: -1 }` internal error                                                                  | `WalletRequestFailedError` |

`FreighterWalletAdapter` turns Freighter's error objects into plain `Error`s
carrying Freighter's message, so these messages are matched exactly.

**Errors from the SDK's own adapters**

| Error                                                                                             | Wraith error              |
| :------------------------------------------------------------------------------------------------ | :------------------------ |
| `The viem wallet client has no connected account.`                                                | `WalletNotConnectedError` |
| `The Solana wallet is not connected.`                                                             | `WalletNotConnectedError` |
| `Freighter is not connected.`                                                                     | `WalletNotConnectedError` |
| The constructors' `TypeError` for a wallet without `signMessage` (and `getAddress` for Freighter) | `WalletUnavailableError`  |

Everything else becomes `WalletRequestFailedError` with `providerCode` and
`reason` set. For example, MetaMask and Phantom use `-32002` when a request is
already waiting for the user's approval; you can check
`error.context.providerCode === -32002` and ask the user to open their wallet.

---

## Normalised Events

`watchWalletEvents(source, listener)` subscribes to a provider and returns a
function that unsubscribes.

| Chain     | Source                          | Where it comes from                                                                                                             |
| :-------- | :------------------------------ | :------------------------------------------------------------------------------------------------------------------------------ |
| `evm`     | `{ chain: 'evm', provider }`    | The EIP-1193 provider you gave viem's `custom()` transport, e.g. `window.ethereum`. A viem WalletClient does not expose events. |
| `solana`  | `{ chain: 'solana', wallet }`   | The `@solana/wallet-adapter` adapter, e.g. `useWallet().wallet?.adapter`.                                                       |
| `stellar` | `{ chain: 'stellar', watcher }` | `new WatchWalletChanges(intervalMs)` from `@stellar/freighter-api`.                                                             |

```ts
import { WatchWalletChanges } from '@stellar/freighter-api';
import { watchWalletEvents } from '@wraith-protocol/sdk';

const stop = watchWalletEvents(
  { chain: 'stellar', watcher: new WatchWalletChanges(1000) },
  (event) => {
    switch (event.type) {
      case 'accountChanged':
        console.log('Account is now', event.address);
        break;
      case 'networkChanged':
        console.log('Network is now', event.network);
        break;
      case 'disconnect':
        console.log(event.error.describe());
        break;
    }
  },
);

// later
stop();
```

Every event has `type` and `chain`:

| Event            | Fields                                       | Format                                                                                                            |
| :--------------- | :------------------------------------------- | :---------------------------------------------------------------------------------------------------------------- |
| `accountChanged` | `address`                                    | EVM: EIP-55 checksummed, the same form `ViemWalletAdapter.getAddress()` returns. Solana: base58. Stellar: `G...`. |
| `networkChanged` | `network`                                    | EVM: CAIP-2 `eip155:<chainId>`, e.g. `eip155:1`. Stellar: the network passphrase. Solana: never emitted.          |
| `disconnect`     | `error` (always a `WalletNotConnectedError`) | `error.context.providerCode` and `error.cause` carry the provider's disconnect error, if it sent one.             |

How provider events become normalised events:

| Provider event                                                      | Normalised event                       |
| :------------------------------------------------------------------ | :------------------------------------- |
| EIP-1193 `accountsChanged` with accounts                            | `accountChanged` for the first account |
| EIP-1193 `accountsChanged` with `[]` (locked or disconnected)       | `disconnect`                           |
| EIP-1193 `chainChanged`, or `connect` with a `chainId`              | `networkChanged`                       |
| EIP-1193 `disconnect`                                               | `disconnect`                           |
| Solana `connect`, which adapters also emit when the account changes | `accountChanged`                       |
| Solana `disconnect`                                                 | `disconnect`                           |
| Freighter poll: address changed                                     | `accountChanged`                       |
| Freighter poll: network passphrase changed                          | `networkChanged`                       |
| Freighter poll: empty address (the site lost access)                | `disconnect`                           |

The rules that make the stream consistent:

- Repeats are dropped: an account or network is reported only when it changes. EVM addresses are compared after checksumming.
- After a `disconnect`, the next account and network are reported again, even if they match the ones from before.
- Freighter's watcher polls, so its first poll reports the current state. If the site has no access yet, that is a `disconnect`.
- Freighter polls that fail are ignored, because they say nothing reliable about the wallet.
- EIP-1193 `disconnect` codes follow the WebSocket `CloseEvent` codes (such as `1013`), not `4900`. Every `disconnect` event is treated as a disconnect whatever its code.

---

## Checking the Network

`ViemWalletAdapter` and `FreighterWalletAdapter` have a `getNetwork()` method
that returns the wallet's network in the same format as `networkChanged`
events. `assertWalletNetwork()` compares it with the network you expect:

```ts
import { Networks } from '@stellar/stellar-sdk';
import { assertWalletNetwork } from '@wraith-protocol/sdk';

await assertWalletNetwork(evmAdapter, `eip155:${chain.id}`);
await assertWalletNetwork(stellarAdapter, Networks.TESTNET);
```

It throws `WalletWrongNetworkError` with `expectedNetwork` and `actualNetwork`
in its context.

| Adapter                  | `getNetwork()` source                                                                                                            |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------- |
| `ViemWalletAdapter`      | The client's `getChainId()`, which every viem WalletClient has.                                                                  |
| `FreighterWalletAdapter` | `getNetwork()` from `@stellar/freighter-api` 3 or later; pass the API object that includes it.                                   |
| `SolanaWalletAdapter`    | None. `@solana/wallet-adapter` does not expose the wallet's cluster, so `assertWalletNetwork()` throws `WalletUnavailableError`. |

Unlike `signMessage()` and `getAddress()`, `getNetwork()` is new and rejects
with normalised `WraithWalletError`s.

The signatures used to derive stealth keys do not depend on the network, so
`deriveStealthKeysFromWallet()` does not check it. Use `assertWalletNetwork()`
where your app needs the wallet on a particular network.

---

## Adapter Behaviour Reference

Results are shown after normalisation. `test/wallet/conformance.test.ts` runs
each scenario against all three adapters, with mock providers that reproduce
each library's real error and event shapes.

| Scenario                                           | viem                                                                                   | Solana wallet-adapter                                                            | Freighter                                                                              |
| :------------------------------------------------- | :------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------- |
| `getAddress()` before connecting                   | `WalletNotConnectedError`                                                              | `WalletNotConnectedError`                                                        | `WalletNotConnectedError`                                                              |
| User declines the connection request               | `WalletUserRejectedError`                                                              | `WalletUserRejectedError`                                                        | `WalletUserRejectedError`                                                              |
| Wallet disconnects                                 | `disconnect` event; `getAddress()` rejects with `WalletNotConnectedError`              | Same                                                                             | Same (seen on the next watcher poll)                                                   |
| `signMessage()` after a disconnect                 | `WalletNotConnectedError`                                                              | `WalletNotConnectedError`                                                        | Freighter asks for access again; declining gives `WalletUserRejectedError`             |
| Wallet on another network                          | `networkChanged` event; `assertWalletNetwork()` rejects with `WalletWrongNetworkError` | No network events; `assertWalletNetwork()` rejects with `WalletUnavailableError` | `networkChanged` event; `assertWalletNetwork()` rejects with `WalletWrongNetworkError` |
| User rejects the signature                         | `WalletUserRejectedError`                                                              | `WalletUserRejectedError`                                                        | `WalletUserRejectedError`                                                              |
| Retry after rejection, reconnect or network switch | Succeeds; derived keys are identical to a first-time success                           | Same                                                                             | Same                                                                                   |
| Wallet unavailable                                 | `4200` gives `WalletUnavailableError`                                                  | `WalletNotReadyError` gives `WalletUnavailableError`                             | Node environment error gives `WalletUnavailableError`                                  |
| Wallet object without `signMessage`                | Constructor `TypeError`; normalises to `WalletUnavailableError`                        | Same                                                                             | Same                                                                                   |

### Retrying

The adapters keep no state between calls, so a call can be retried as soon as
the user has fixed the cause:

- `WalletUserRejectedError`: don't retry automatically. Let the user try again from your UI.
- `WalletNotConnectedError`: reconnect, then retry.
- `WalletWrongNetworkError`: switch networks, then retry. On EVM, a switch that fails with `4902` also maps to this error; add the chain with `wallet_addEthereumChain` first.
- `WalletUnavailableError`: retrying won't help until the user installs or enables a suitable wallet.
- `WalletRequestFailedError`: the cause may be temporary. Retry once, then check `providerCode` and `cause`.

### Freighter Notes

These come from the `@stellar/freighter-api` 6.0.1 source:

- `getAddress()` returns an empty address, not an error, when the site has no access. When the extension is not installed, the address request resolves empty after a 2-second timeout. Both surface as `WalletNotConnectedError`; use Freighter's `isConnected()` to tell whether the extension is installed.
- Only the connection-status and public-key requests have that timeout. Other requests, including `signMessage()` and `getNetwork()`, wait indefinitely when the extension is missing, so check `isConnected()` before calling them.
- `signMessage()` asks for access first when the site doesn't have it.
