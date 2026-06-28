# Stellar React — Receive Stealth Payments

A minimal Vite + React app that demonstrates deriving Wraith stealth keys on Stellar and displaying the stealth meta-address.

## How it works

1. Paste your 64-byte hex secret key into the textarea
2. Click **Derive Stealth Keys** — calls `deriveStealthKeys` from `@wraith-protocol/sdk/chains/stellar`
3. View your derived spending key, viewing key, and stealth meta-address (`st:xlm:...`)
4. Click the meta-address to copy it — share with senders

## Usage

```bash
# Install dependencies
npm install

# Optionally pre-fill the secret key via env
cp .env.example .env
# Edit .env with VITE_STELLAR_SECRET_KEY

# Start the dev server
npm run dev
```

## Build

```bash
npm run build
npm run preview
```
