# Stellar Spectre Agent Demo

Demonstrates using the Wraith managed agent platform (`@wraith-protocol/sdk`) to create and interact with a Stellar stealth address AI agent.

## How it works

1. Initializes a `Wraith` client with your API key
2. Creates or looks up an agent on the Stellar chain
3. Chats with the agent via natural language to check balances, send stealth payments, and manage notifications
4. Uses the agent's `scanPayments` method to find incoming stealth payments
5. All key derivation, stealth address generation, and on-chain operations run in Wraith's TEE infrastructure — no crypto libraries needed

## Usage

```bash
# 1. Copy and fill in the environment variables
cp .env.example .env
# Edit .env with your API key, agent name, Stellar wallet, and signature

# 2. Run the CLI
npm start
```

## What the demo does

| Step                  | Action                                                           |
| --------------------- | ---------------------------------------------------------------- |
| Create/retrieve agent | Looks up `{name}.wraith` or creates a new one on Stellar         |
| Chat                  | Asks "What's my balance?" and displays the response + tool calls |
| Balance               | Calls `agent.getBalance()` for the native + token balances       |
| Scan payments         | Calls `agent.scanPayments()` to detect incoming stealth payments |
| Notifications         | Checks unread notifications via `agent.getNotifications()`       |
| Send payment          | Sends "send 1 XLM to alice.wraith" as a natural language command |

## Reference

- `Wraith` — API client with `createAgent`, `getAgentByName`, `getAgentByWallet`, `listAgents`
- `WraithAgent` — Per-agent control with `chat`, `getBalance`, `scanPayments`, `getNotifications`, `exportKey`, conversation management
- `Chain.Stellar` — Enum value for the Stellar network
- Full API docs at https://docs.wraith.dev
