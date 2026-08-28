# Multichain Wallet Scanner

A CLI that uses one `WalletAdapter` registry to request the chain-specific
derivation signatures and scan the Wraith Stellar and Horizen test networks.
An optional legacy signature can also enable the existing Solana and CKB scans.

## Wallet registry

Create `wallet-registry.ts` next to the example. The SDK adapters are structural:
the Freighter, viem, and Solana wallet packages remain optional and are never
imported by the SDK adapters themselves.

```ts
import {
  FreighterWalletAdapter,
  ViemWalletAdapter,
  type WalletAdapter,
} from '@wraith-protocol/sdk';
import { createWalletClient, custom } from 'viem';
import { horizenTestnet } from './your-chain-config';
import * as freighter from '@stellar/freighter-api';

const evmClient = createWalletClient({
  chain: horizenTestnet,
  transport: custom(window.ethereum),
});

export const walletAdapters = new Map<string, WalletAdapter>([
  ['stellar', new FreighterWalletAdapter(freighter)],
  ['evm', new ViemWalletAdapter(evmClient)],
]);
```

The same registry can include a `SolanaWalletAdapter` from an
`@solana/wallet-adapter` wallet when a Solana scan is needed.

## Usage

```bash
cp .env.example .env
# Set WALLET_REGISTRY_MODULE to the registry module above.
npm start
```

The CLI asks both wallets to sign their chain's fixed, non-transactional Wraith
message, derives the correct key shape through `deriveStealthKeysFromWallet`,
then scans Stellar testnet and Horizen testnet concurrently.
