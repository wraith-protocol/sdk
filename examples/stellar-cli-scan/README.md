# Stellar CLI — Scan Stealth Payments

Demonstrates how to scan for incoming stealth payments on Stellar using the `@wraith-protocol/sdk/chains/stellar` module.

## How it works

1. Derives stealth viewing/spending keys from a secret key
2. Fetches announcements from the Soroban RPC via `fetchAnnouncements`
3. Filters announcements owned by this wallet via `scanAnnouncements`
4. Prints each matched payment — stealth address, public key, and derived private scalar

## Usage

```bash
# 1. Copy and fill in the environment variables
cp .env.example .env
# Edit .env with your secret key and optional FROM_TIMESTAMP

# 2. Run the CLI
npm start
```

## Output

The script prints:

- The derived viewing key and spending public key
- Total announcements found on-chain
- Number of payments matching your wallet
- For each match: stealth address, stealth public key bytes, and the derived private scalar needed to sign spends
