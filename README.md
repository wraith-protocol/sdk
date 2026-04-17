# @wraith-protocol/sdk

The SDK for the [Wraith](https://github.com/wraith-protocol) multichain stealth address platform. One package, five entry points — an agent client for the managed TEE platform and stealth address cryptography for EVM, Stellar, Solana, and CKB chains.

## Installation

```bash
npm install @wraith-protocol/sdk
# or
pnpm add @wraith-protocol/sdk
```

`@stellar/stellar-sdk` and `@solana/web3.js` are optional peer dependencies — only required if you import their respective chain modules.

## Entry Points

| Import                                | Purpose                                              |
| ------------------------------------- | ---------------------------------------------------- |
| `@wraith-protocol/sdk`                | Agent client (`Wraith`, `WraithAgent`, `Chain` enum) |
| `@wraith-protocol/sdk/chains/evm`     | EVM stealth address crypto (secp256k1)               |
| `@wraith-protocol/sdk/chains/stellar` | Stellar stealth address crypto (ed25519)             |
| `@wraith-protocol/sdk/chains/solana`  | Solana stealth address crypto (ed25519)              |
| `@wraith-protocol/sdk/chains/ckb`     | CKB (Nervos) stealth address crypto (secp256k1)      |

## Agent Client

The root export provides `Wraith` and `WraithAgent` — a lightweight HTTP client for the Wraith managed TEE platform.

```ts
import { Wraith, Chain } from '@wraith-protocol/sdk';

const wraith = new Wraith({
  apiKey: 'wraith_live_abc123',
});

// Create a single-chain agent
const agent = await wraith.createAgent({
  name: 'alice',
  chain: Chain.Horizen,
  wallet: '0x...',
  signature: '0x...',
});

// Chat with the agent
const res = await agent.chat('send 0.1 ETH to bob.wraith');
console.log(res.response);

// Check balance
const balance = await agent.getBalance();
console.log(balance.native, balance.tokens);
```

### Chain Enum

The `Chain` enum defines all supported chains. Pass a single chain, an array, or `Chain.All` to deploy on every supported chain at once.

```ts
enum Chain {
  Horizen = 'horizen',
  Ethereum = 'ethereum',
  Polygon = 'polygon',
  Base = 'base',
  Stellar = 'stellar',
  Solana = 'solana',
  CKB = 'ckb',
  All = 'all',
}
```

#### Multichain Agent

```ts
const agent = await wraith.createAgent({
  name: 'alice',
  chain: [Chain.Horizen, Chain.Stellar, Chain.Ethereum],
  wallet: '0x...',
  signature: '0x...',
});

console.log(agent.info.chains); // ['horizen', 'stellar', 'ethereum']
console.log(agent.info.addresses); // { horizen: '0x...', stellar: 'G...', ethereum: '0x...' }
```

#### All Chains

```ts
const agent = await wraith.createAgent({
  name: 'alice',
  chain: Chain.All,
  wallet: '0x...',
  signature: '0x...',
});
```

### Bring Your Own Model

```ts
const wraith = new Wraith({
  apiKey: 'wraith_live_abc123',
  ai: {
    provider: 'openai',
    apiKey: 'sk-...',
  },
});
```

## EVM Stealth Addresses

Stealth address cryptography for all EVM-compatible chains using secp256k1.

```ts
import {
  deriveStealthKeys,
  generateStealthAddress,
  scanAnnouncements,
  deriveStealthPrivateKey,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  SCHEME_ID,
  type Announcement,
  type HexString,
} from '@wraith-protocol/sdk/chains/evm';

// Derive stealth keys from a wallet signature
const keys = deriveStealthKeys(walletSignature as HexString);

// Encode as a meta-address to share publicly
const metaAddress = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
// => "st:eth:0x..."

// Sender: generate a one-time stealth address
const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(metaAddress);
const stealth = generateStealthAddress(spendingPubKey, viewingPubKey);
// => { stealthAddress: '0x...', ephemeralPubKey: '0x...', viewTag: 42 }

// Recipient: scan announcements to find payments
const matched = scanAnnouncements(
  announcements,
  keys.viewingKey,
  keys.spendingPubKey,
  keys.spendingKey,
);

// Recipient: derive the private key that controls the stealth address
const privKey = deriveStealthPrivateKey(keys.spendingKey, stealth.ephemeralPubKey, keys.viewingKey);
```

## Stellar Stealth Addresses

Stealth address cryptography for Stellar using ed25519 and X25519 ECDH.

```ts
import {
  deriveStealthKeys,
  generateStealthAddress,
  scanAnnouncements,
  deriveStealthPrivateScalar,
  signStellarTransaction,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  SCHEME_ID,
  bytesToHex,
} from '@wraith-protocol/sdk/chains/stellar';

// Derive stealth keys from a wallet signature (64-byte ed25519 sig)
const keys = deriveStealthKeys(signatureBytes);

// Encode as a meta-address
const metaAddress = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
// => "st:xlm:..."

// Sender: generate a one-time stealth address
const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(metaAddress);
const stealth = generateStealthAddress(spendingPubKey, viewingPubKey);
// => { stealthAddress: 'G...', ephemeralPubKey: Uint8Array, viewTag: 117 }

// Recipient: scan announcements
const matched = scanAnnouncements(
  announcements,
  keys.viewingKey,
  keys.spendingPubKey,
  keys.spendingScalar,
);

// Recipient: sign a Stellar transaction with the stealth private scalar
const signature = signStellarTransaction(
  txHash,
  matched[0].stealthPrivateScalar,
  matched[0].stealthPubKeyBytes,
);
```

## CKB (Nervos) Stealth Addresses

Stealth address cryptography for CKB using secp256k1 with blake2b hashing. CKB uses a UTXO-based Cell model where the Cell itself is the announcement. No separate announcer contract needed.

```ts
import {
  deriveStealthKeys,
  generateStealthAddress,
  scanStealthCells,
  deriveStealthPrivateKey,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  fetchStealthCells,
  SCHEME_ID,
  type StealthCell,
  type HexString,
} from '@wraith-protocol/sdk/chains/ckb';

// Derive stealth keys from a wallet signature
const keys = deriveStealthKeys(walletSignature as HexString);

// Encode as a meta-address
const metaAddress = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
// => "st:ckb:..."

// Sender: generate a stealth address (returns lock script args)
const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(metaAddress);
const stealth = generateStealthAddress(spendingPubKey, viewingPubKey);
// => { stealthPubKey, stealthPubKeyHash, ephemeralPubKey, lockArgs }
// lockArgs = ephemeral_pubkey (33 bytes) || blake160(stealth_pubkey) (20 bytes)

// Recipient: fetch and scan stealth cells
const cells = await fetchStealthCells('ckb');
const matched = scanStealthCells(cells, keys.viewingKey, keys.spendingPubKey, keys.spendingKey);

// Recipient: derive the private key to spend
const privKey = deriveStealthPrivateKey(
  keys.spendingKey,
  matched[0].ephemeralPubKey,
  keys.viewingKey,
);
```

## Documentation

Full protocol documentation, architecture details, and integration guides are available at [wraith-protocol/docs](https://github.com/wraith-protocol/docs).

## License

MIT
