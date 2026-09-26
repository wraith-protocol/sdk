# @wraith-protocol/sdk-svelte

Svelte reactive stores for `@wraith-protocol/sdk`. Works with Svelte 4 and 5.

## Installation

```bash
npm install @wraith-protocol/sdk @wraith-protocol/sdk-svelte
```

## Primitives

### `useWraith`

Reactive Wraith API client.

```svelte
<script lang="ts">
  import { useWraith } from '@wraith-protocol/sdk-svelte';
  import { Chain } from '@wraith-protocol/sdk';

  const { init, createAgent, chat, agentInfo, loading, error } = useWraith();

  init({ apiKey: 'wraith_...' });

  async function start() {
    await createAgent({
      name: 'my-agent',
      chain: Chain.Stellar,
      wallet: 'G...',
      signature: 'sig',
    });
    const response = await chat('Hello!');
  }
</script>

{#if $loading}
  <p>Loading...</p>
{/if}

{#if $agentInfo}
  <p>Agent: {$agentInfo.name}</p>
{/if}
```

### `useStellarStealthKeys`

```svelte
<script lang="ts">
  import { useStellarStealthKeys } from '@wraith-protocol/sdk-svelte';

  const { deriveKeys, generateAddress, keys, stealthAddress, loading } =
    useStellarStealthKeys();

  const k = deriveKeys(signature);
  const addr = generateAddress(k.spendingPubKey, k.viewingPubKey);
</script>

{#if $keys}
  <p>Spending key: {$keys.spendingPubKey}</p>
{/if}
```

### `useEvmStealthKeys`

```svelte
<script lang="ts">
  import { useEvmStealthKeys } from '@wraith-protocol/sdk-svelte';

  const { deriveKeys, generateAddress, derivePrivateKey, keys, stealthAddress } = useEvmStealthKeys();

  const k = deriveKeys('0x...');
  const addr = generateAddress(k.spendingPubKey, k.viewingPubKey);
</script>
```

### `useSolanaStealthKeys`

```svelte
<script lang="ts">
  import { useSolanaStealthKeys } from '@wraith-protocol/sdk-svelte';

  const { deriveKeys, generateAddress, scanAnnouncements, keys, matched } = useSolanaStealthKeys();

  const k = deriveKeys(signature);
  const addr = generateAddress(k.spendingPubKey, k.viewingPubKey);
</script>
```

### `useStealthMetaAddress`

Multi-chain meta address encode/decode.

```svelte
<script lang="ts">
  import { useStealthMetaAddress } from '@wraith-protocol/sdk-svelte';

  const { encode, decode, detectChain, encoded, decoded } = useStealthMetaAddress();

  const addr = encode(spendingPubKey, viewingPubKey, 'stellar');
  const parsed = decode(addr);
  const chain = detectChain(addr);
</script>

<p>Encoded: {$encoded}</p>
```

## API

Each primitive returns Svelte `Readable` stores (subscription-based, prefix with `$`) and action methods:

| State            | Type                                        | Description                                |
| ---------------- | ------------------------------------------- | ------------------------------------------ |
| `loading`        | `Readable<boolean>`                         | True while an async operation is in flight |
| `error`          | `Readable<string \| null>`                  | Last error message                         |
| `keys`           | `Readable<StealthKeys \| null>`             | Derived stealth keys                       |
| `stealthAddress` | `Readable<GeneratedStealthAddress \| null>` | Generated stealth address                  |
| `announcements`  | `Readable<Announcement[]>`                  | Fetched announcements                      |
| `matched`        | `Readable<MatchedAnnouncement[]>`           | Matched announcements after scan           |
| `metaAddress`    | `Readable<string \| null>`                  | Encoded stealth meta address               |

## Development

```bash
pnpm install
pnpm build
pnpm test
```
