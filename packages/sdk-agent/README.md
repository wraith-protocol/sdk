# @wraith-protocol/sdk-agent

Agent client for the Wraith multichain stealth address platform. This package provides the Wraith and WraithAgent classes for interacting with the Wraith managed agent API, along with Claude-compatible agent tools.

## Installation

```bash
npm install @wraith-protocol/sdk-agent
```

## Usage

### Basic Agent Client

```typescript
import { Wraith, Chain } from '@wraith-protocol/sdk-agent';

const wraith = new Wraith({
  apiKey: 'wraith_live_abc123...',
});

// Create a single-chain agent
const agent = await wraith.createAgent({
  name: 'alice',
  chain: Chain.Stellar,
  wallet: '0x...',
  signature: '0x...',
});

// Chat with the agent
const response = await agent.chat('send 10 XLM to bob.wraith');
console.log('Agent:', response.response);

// Check balance
const balance = await agent.getBalance();
console.log('Balance:', balance);
```

### Multichain Agent

```typescript
// Create a multichain agent
const multiAgent = await wraith.createAgent({
  name: 'bob',
  chain: [Chain.Ethereum, Chain.Stellar],
  wallet: '0x...',
  signature: '0x...',
});

// The AI routes to the correct chain automatically
await multiAgent.chat('send 10 XLM to carol.wraith on stellar');
await multiAgent.chat("what's my balance on all chains?");
```

### Deploy on All Chains

```typescript
// Deploy on every supported chain
const omniAgent = await wraith.createAgent({
  name: 'carol',
  chain: Chain.All,
  wallet: '0x...',
  signature: '0x...',
});
```

### Agent Methods

```typescript
// Get agent by wallet address
const agent = await wraith.getAgentByWallet('0xwallet');

// Get agent by name
const agent = await wraith.getAgentByName('alice');

// List all agents
const agents = await wraith.listAgents();

// Agent operations
await agent.chat('message');
await agent.getBalance();
await agent.scanPayments();
await agent.getNotifications();
await agent.markNotificationsRead();
await agent.getConversations();
await agent.deleteConversation('conv-id');
```

### Claude Agent Tools

```typescript
import { createClaudeAgentTools } from '@wraith-protocol/sdk-agent';

const tools = createClaudeAgentTools();

// Send to meta-address
const sendResult = await tools.sendToMetaAddress({
  metaAddress: 'st:xlm:...',
  amount: '10',
  asset: 'XLM',
  memo: 'Payment',
});

// Scan for payments
const scanResult = await tools.scan({
  announcements: [...],
  viewingKeyHex: '...',
  spendingPubKeyHex: '...',
  spendingScalarHex: '...',
});

// Withdraw from stealth address
const withdrawResult = await tools.withdraw({
  stealthAddress: 'G...',
  amount: '5',
  asset: 'XLM',
  destination: 'GA...',
});

// Resolve name
const resolveResult = await tools.resolveName({
  name: 'alice',
  chain: 'stellar',
});
```

## Adapter Shape

Third-party agent frameworks (Vercel AI SDK, Mastra, etc.) can integrate with Wraith by implementing the following adapter pattern:

```typescript
interface WraithAgentAdapter {
  // Configuration
  apiKey: string;
  baseUrl?: string;
  aiProvider?: 'gemini' | 'openai' | 'claude';
  aiApiKey?: string;

  // Agent lifecycle
  createAgent(config: {
    name: string;
    chain: Chain | Chain[];
    wallet: string;
    signature: string;
    message?: string;
  }): Promise<WraithAgent>;

  // Agent operations
  chat(agentId: string, message: string, conversationId?: string): Promise<ChatResponse>;
  getBalance(agentId: string): Promise<Balance>;
  scanPayments(agentId: string): Promise<Payment[]>;
  getNotifications(
    agentId: string,
  ): Promise<{ notifications: Notification[]; unreadCount: number }>;
}

// Example: Vercel AI SDK integration
export function createWraithTools(config: WraithAgentAdapter) {
  return {
    wraith_send: async ({ metaAddress, amount, asset }) => {
      const tools = createClaudeAgentTools();
      return tools.sendToMetaAddress({ metaAddress, amount, asset });
    },
    wraith_scan: async ({ announcements, viewingKeyHex, spendingPubKeyHex, spendingScalarHex }) => {
      const tools = createClaudeAgentTools();
      return tools.scan({ announcements, viewingKeyHex, spendingPubKeyHex, spendingScalarHex });
    },
    // ... more tools
  };
}
```

## Chain Enum

```typescript
enum Chain {
  Horizen = 'horizen',
  Ethereum = 'ethereum',
  Polygon = 'polygon',
  Base = 'base',
  Stellar = 'stellar',
  Solana = 'solana',
  All = 'all',
}
```

## Types

```typescript
interface WraithConfig {
  apiKey: string;
  baseUrl?: string;
  ai?: {
    provider: 'gemini' | 'openai' | 'claude';
    apiKey: string;
  };
}

interface AgentConfig {
  name: string;
  chain: Chain | Chain[];
  wallet: string;
  signature: string;
  message?: string;
}

interface AgentInfo {
  id: string;
  name: string;
  chains: Chain[];
  addresses: Record<Chain, string>;
  metaAddresses: Record<Chain, string>;
}

interface ChatResponse {
  response: string;
  toolCalls?: ToolCall[];
  conversationId: string;
}

interface Balance {
  native: string;
  tokens: Record<string, string>;
}

interface Payment {
  stealthAddress: string;
  balance: string;
  ephemeralPubKey: string;
}

interface Notification {
  id: number;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
```

## API

The Wraith agent client communicates with the Wraith API (default: `https://api.wraith.dev`). All requests are authenticated via the `Authorization: Bearer wraith_...` header.

Optional AI provider configuration can be passed to use your own AI provider instead of the default:

```typescript
const wraith = new Wraith({
  apiKey: 'wraith_live_abc123...',
  ai: {
    provider: 'openai',
    apiKey: 'sk-...',
  },
});
```

## License

MIT
