# Stellar CLI — Send Stealth Payment

Demonstrates how to generate a stealth address for a recipient on Stellar using the `@wraith-protocol/sdk/chains/stellar` module.

## How it works

1. Derives your own stealth keys from a secret key (representing `wallet.sign(STEALTH_SIGNING_MESSAGE)`)
2. Encodes and displays your own stealth meta-address (`st:xlm:...`)
3. Decodes the recipient's meta-address from the `RECIPIENT_META_ADDRESS` env var
4. Generates a one-time stealth address for the recipient using ECDH and stores
5. Prints deployment info (Horizon URL, announcer contract address)

## Usage

```bash
# 1. Copy and fill in the environment variables
cp .env.example .env
# Edit .env with your secret key and the recipient's meta-address

# 2. Run the CLI
npm start
```

## Output

The script prints:

- Your own stealth meta-address (share this with senders)
- The recipient's decoded public keys
- The generated one-time stealth address to send XLM to
- The ephemeral public key and view tag needed for the on-chain announcement
- The Soroban announcer contract and Horizon URL for the selected network
