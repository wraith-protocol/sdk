export enum Chain {
  Horizen = 'horizen',
  Ethereum = 'ethereum',
  Polygon = 'polygon',
  Base = 'base',
  Stellar = 'stellar',
  Solana = 'solana',
  All = 'all',
}

export interface WraithConfig {
  apiKey: string;
  baseUrl?: string;
  ai?: {
    provider: 'gemini' | 'openai' | 'claude';
    apiKey: string;
  };
}

export interface AgentConfig {
  name: string;
  chain: Chain | Chain[];
  wallet: string;
  signature: string;
  message?: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  chains: Chain[];
  addresses: Record<Chain, string>;
  metaAddresses: Record<Chain, string>;
}

export interface ChatResponse {
  response: string;
  toolCalls?: ToolCall[];
  conversationId: string;
}

export interface ToolCall {
  name: string;
  status: string;
  detail?: string;
}

export interface Balance {
  native: string;
  tokens: Record<string, string>;
}

export interface Payment {
  stealthAddress: string;
  balance: string;
  ephemeralPubKey: string;
}

export interface Invoice {
  id: string;
  agentName: string;
  amount: string;
  asset: string;
  memo: string;
  status: 'pending' | 'paid';
  txHash: string | null;
  paymentLink: string;
  createdAt: string;
}

export interface Schedule {
  id: string;
  recipient: string;
  amount: string;
  asset: string;
  interval: 'daily' | 'weekly' | 'monthly';
  status: 'active' | 'paused' | 'cancelled';
  nextRun: string;
}

export interface TxResult {
  txHash: string;
  txLink: string;
}

export interface PrivacyReport {
  score: number;
  issues: Array<{
    severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
    issue: string;
    recommendation: string;
  }>;
  bestPractices: string[];
}

export interface Notification {
  id: number;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
