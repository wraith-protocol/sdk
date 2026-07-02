# Multichain Stealth Payment Scanner

A CLI that scans for incoming stealth payments across all 4 supported chains in parallel — Stellar, EVM, Solana, and CKB.

## How it works

1. Derives stealth keys from a single secret key
2. Fetches announcements on all 4 chains simultaneously via `Promise.all`
3. Filters announcements owned by this wallet using each chain's scan function
4. Prints matched payments grouped by chain

## Supported Chains

| Chain   | Fetch function       | Scan function       | Crypto    |
| ------- | -------------------- | ------------------- | --------- |
| Stellar | `fetchAnnouncements` | `scanAnnouncements` | ed25519   |
| EVM     | `fetchAnnouncements` | `scanAnnouncements` | secp256k1 |
| Solana  | `fetchAnnouncements` | `scanAnnouncements` | ed25519   |
| CKB     | `fetchStealthCells`  | `scanStealthCells`  | secp256k1 |

## Usage

```bash
# 1. Copy and fill in the environment variables
cp .env.example .env
# Edit .env with your SECRET_KEY

# 2. Run the scanner
npm start
```

## Output

The script prints results per chain — total announcements found, matched payments, and details for each match including stealth address, ephemeral public key, and derived private key/scalar.
