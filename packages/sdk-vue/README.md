# @wraith-protocol/sdk-vue

Vue 3 Composition API wrappers for `@wraith-protocol/sdk`.

## Installation

```bash
npm install @wraith-protocol/sdk @wraith-protocol/sdk-vue
```

## Composables

### `useWraith`

Reactive Wraith API client.

```ts
import { useWraith } from '@wraith-protocol/sdk-vue';

const { init, createAgent, getAgent, chat, agent, agentInfo, loading, error } = useWraith();

init({ apiKey: 'wraith_...' });

const myAgent = await createAgent({
  name: 'my-agent',
  chain: Chain.Stellar,
  wallet: 'G...',
  signature: 'sig',
});

const response = await chat('Hello!');
```

### `useStellarStealthKeys`

```ts
import { useStellarStealthKeys } from '@wraith-protocol/sdk-vue';

const { deriveKeys, generateAddress, checkAddress, keys, stealthAddress, loading } =
  useStellarStealthKeys();

const k = deriveKeys(signature);
const addr = generateAddress(k.spendingPubKey, k.viewingPubKey);
```

### `useEvmStealthKeys`

```ts
import { useEvmStealthKeys } from '@wraith-protocol/sdk-vue';

const { deriveKeys, generateAddress, derivePrivateKey, keys, stealthAddress } = useEvmStealthKeys();

const k = deriveKeys('0x...');
const addr = generateAddress(k.spendingPubKey, k.viewingPubKey);
```

### `useSolanaStealthKeys`

```ts
import { useSolanaStealthKeys } from '@wraith-protocol/sdk-vue';

const { deriveKeys, generateAddress, scanAnnouncements, keys, matched } = useSolanaStealthKeys();

const k = deriveKeys(signature);
const addr = generateAddress(k.spendingPubKey, k.viewingPubKey);
```

### `useStealthMetaAddress`

Multi-chain meta address encode/decode.

```ts
import { useStealthMetaAddress } from '@wraith-protocol/sdk-vue';

const { encode, decode, detectChain, encoded, decoded } = useStealthMetaAddress();

const addr = encode(spendingPubKey, viewingPubKey, 'stellar');
const parsed = decode(addr); // auto-detects chain
const chain = detectChain(addr); // 'stellar'
```

## API

Each composable returns reactive state via `ref` (wrapped with `readonly`) and action methods:

| State            | Type                                   | Description                                |
| ---------------- | -------------------------------------- | ------------------------------------------ |
| `loading`        | `Ref<boolean>`                         | True while an async operation is in flight |
| `error`          | `Ref<string \| null>`                  | Last error message                         |
| `keys`           | `Ref<StealthKeys \| null>`             | Derived stealth keys                       |
| `stealthAddress` | `Ref<GeneratedStealthAddress \| null>` | Generated stealth address                  |
| `announcements`  | `Ref<Announcement[]>`                  | Fetched announcements                      |
| `matched`        | `Ref<MatchedAnnouncement[]>`           | Matched announcements after scan           |
| `metaAddress`    | `Ref<string \| null>`                  | Encoded stealth meta address               |

## Development

```bash
pnpm install
pnpm build
pnpm test
```
