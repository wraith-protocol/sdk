# React Stellar Example App

Example React application demonstrating the `@wraith-protocol/sdk-react` hooks.

## Features

- Derive stealth keys from wallet signature
- Display stealth meta-address
- Scan for incoming stealth payments
- View balances of stealth addresses
- Auto-polling for new payments and balance updates

## Running

```bash
# Install dependencies (from workspace root)
pnpm install

# Run dev server
cd examples/react-stellar-app
pnpm dev
```

## Usage

1. Click "Generate Mock Signature" to create a test signature
2. View your derived stealth meta-address
3. Click "Scan Now" to check for payments
4. Click on any found payment to view its balance

## Production Integration

In a production app, replace the mock signature generation with actual wallet integration:

```tsx
import { signMessage } from '@stellar/freighter-api';

const signature = await signMessage(STEALTH_SIGNING_MESSAGE);
```

See the main SDK documentation for complete integration examples.
