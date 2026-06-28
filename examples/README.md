# Wraith SDK Examples

Five self-contained examples demonstrating the `@wraith-protocol/sdk` across different chains and usage patterns.

## Example Index

| Directory                | Description                                                                                                                            | Type  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `stellar-cli-send/`      | Derive stealth keys, encode a meta-address, generate a stealth address for a recipient, print deployment info                          | CLI   |
| `stellar-cli-scan/`      | Fetch and scan on-chain announcements to find incoming stealth payments                                                                | CLI   |
| `stellar-react-receive/` | Minimal Vite + React app — input a secret key, derive stealth keys, view and copy your meta-address                                    | React |
| `stellar-spectre-agent/` | Connect to the Wraith managed agent platform — create/retrieve an agent, chat, check balance, scan payments, send via natural language | Agent |
| `multichain-scan/`       | Scan for stealth payments on all 4 chains (Stellar, EVM, Solana, CKB) in parallel via `Promise.all`                                    | CLI   |

## Running an Example

Each example is self-contained with its own `package.json` and `.env.example`.

```bash
# 1. Navigate to the example directory
cd examples/stellar-cli-send

# 2. Install dependencies (links to the SDK via file:../..)
npm install

# 3. Copy and fill in environment variables
cp .env.example .env
# Edit .env with your keys and addresses

# 4. Run the example
npm start
```

## Notes

- All examples link to the SDK via `"@wraith-protocol/sdk": "file:../.."` — no need to publish or link manually.
- CLI examples use `tsx` to execute TypeScript directly.
- React example (`stellar-react-receive`) uses Vite — run `npm run dev` for the dev server.
- Agent example (`stellar-spectre-agent`) requires a Wraith API key from https://wraith.dev.
- Multichain example (`multichain-scan`) requires optional peer deps (`@solana/web3.js`, `@stellar/stellar-sdk`) — these are available as workspace devDependencies.
