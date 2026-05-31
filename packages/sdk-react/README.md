# @wraith-protocol/sdk-react

React hooks for Wraith Protocol stealth address SDK.

## Installation

```bash
npm install @wraith-protocol/sdk-react @wraith-protocol/sdk @stellar/stellar-sdk react
```

## Hooks

### `useStellarStealthKeys`

Derives stealth keys from a wallet signature. Memoizes the result and only re-derives when the signature changes.

```tsx
import { useStellarStealthKeys } from '@wraith-protocol/sdk-react';

function MyComponent() {
  const signature = '0x...'; // 64-byte ed25519 signature
  const { keys, isReady, error } = useStellarStealthKeys(signature);

  if (!isReady) return <div>Deriving keys...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return <div>Keys ready!</div>;
}
```

### `useStellarAnnouncementScan`

Scans for stealth address announcements belonging to the user. Auto-polls at the specified interval.

```tsx
import { useStellarAnnouncementScan } from '@wraith-protocol/sdk-react';

function MyComponent() {
  const { keys } = useStellarStealthKeys(signature);
  const { matches, isScanning, lastScanAt, refetch } = useStellarAnnouncementScan(keys, {
    intervalMs: 30000, // Poll every 30s
  });

  return (
    <div>
      <p>Found {matches.length} payments</p>
      <p>Last scan: {lastScanAt?.toLocaleString()}</p>
      <button onClick={refetch} disabled={isScanning}>
        {isScanning ? 'Scanning...' : 'Refresh'}
      </button>
    </div>
  );
}
```

### `useStellarSendStealthPayment`

Sends a stealth payment on Stellar. Returns a send function and declarative state for UI rendering.

```tsx
import { useStellarSendStealthPayment } from '@wraith-protocol/sdk-react';

function MyComponent() {
  const { send, status, stealthAddress, error, reset } = useStellarSendStealthPayment();

  const handleSend = async () => {
    await send({
      recipientMetaAddress: 'st:stellar:0x...',
      amount: '10',
    });
  };

  if (status === 'success') {
    return <div>Payment sent to {stealthAddress}</div>;
  }

  return (
    <div>
      <button onClick={handleSend} disabled={status !== 'idle'}>
        {status === 'preparing' && 'Preparing...'}
        {status === 'signing' && 'Signing...'}
        {status === 'submitting' && 'Submitting...'}
        {status === 'idle' && 'Send Payment'}
      </button>
      {error && <p>Error: {error.message}</p>}
    </div>
  );
}
```

### `useStellarName`

Resolves a Stellar name to a stealth meta-address. Debounces input by 300ms and caches resolutions.

```tsx
import { useStellarName } from '@wraith-protocol/sdk-react';

function MyComponent() {
  const [name, setName] = useState('');
  const { metaAddress, isResolving, error } = useStellarName(name);

  return (
    <div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="alice.stellar"
      />
      {isResolving && <span>Resolving...</span>}
      {metaAddress && <span>Address: {metaAddress}</span>}
      {error && <span>Error: {error.message}</span>}
    </div>
  );
}
```

### `useStellarBalance`

Fetches Stellar account balance (XLM and assets). Auto-polls at the specified interval.

```tsx
import { useStellarBalance } from '@wraith-protocol/sdk-react';

function MyComponent() {
  const address = 'G...';
  const { xlm, assets, isLoading, refetch } = useStellarBalance(address, {
    intervalMs: 15000, // Poll every 15s
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      <p>XLM: {xlm}</p>
      {assets.map((asset) => (
        <p key={`${asset.code}-${asset.issuer}`}>
          {asset.code}: {asset.balance}
        </p>
      ))}
      <button onClick={refetch}>Refresh</button>
    </div>
  );
}
```

## Features

- **React 18+ only** - Uses modern React APIs
- **Strict Mode safe** - No side effects in render, no double-fire issues
- **Standalone** - No global state library required
- **React Native compatible** - Works in React Native environments
- **Small bundle size** - ≤ 5 KB gzipped for Stellar-only usage

## License

MIT
