declare module '@wraith-protocol/sdk-agent' {
  export class Wraith {
    constructor(config: {
      apiKey: string;
      baseUrl?: string;
      ai?: {
        provider: 'gemini' | 'openai' | 'claude';
        apiKey: string;
      };
    });
    createAgent(config: {
      name: string;
      chain: Chain | Chain[];
      wallet: string;
      signature: string;
      message?: string;
    }): Promise<WraithAgent>;
    agent(agentId: string): WraithAgent;
    getAgentByWallet(walletAddress: string): Promise<WraithAgent>;
    getAgentByName(name: string): Promise<WraithAgent>;
    listAgents(): Promise<AgentInfo[]>;
  }

  export class WraithAgent {
    readonly info: AgentInfo;
    chat(message: string, conversationId?: string): Promise<ChatResponse>;
    getStatus(): Promise<any>;
    getBalance(): Promise<Balance>;
    scanPayments(): Promise<Payment[]>;
    exportKey(signature: string, message: string): Promise<{ secret: string }>;
    getConversations(): Promise<Conversation[]>;
    getMessages(conversationId: string): Promise<Array<{ role: string; text: string }>>;
    deleteConversation(conversationId: string): Promise<void>;
    getNotifications(): Promise<{ notifications: Notification[]; unreadCount: number }>;
    markNotificationsRead(): Promise<void>;
    clearNotifications(): Promise<void>;
  }

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

  export function createClaudeAgentTools(context?: ClaudeAgentToolContext): ClaudeAgentTools;

  export interface ClaudeAgentToolContext {
    apiKey?: string;
    baseUrl?: string;
  }

  export interface SendToMetaAddressInput {
    metaAddress: string;
    amount: string;
    asset?: string;
    memo?: string;
    destination?: string;
  }

  export interface ScanInput {
    announcements: any[];
    viewingKeyHex: string;
    spendingPubKeyHex: string;
    spendingScalarHex: string;
  }

  export interface WithdrawInput {
    stealthAddress: string;
    amount: string;
    asset?: string;
    destination?: string;
    memo?: string;
  }

  export interface ResolveNameInput {
    name: string;
    chain?: string;
  }

  export interface ToolResult {
    kind: 'send' | 'scan' | 'withdraw' | 'resolve-name';
    signingRequired: boolean;
    tx?: Record<string, unknown>;
    metaAddress?: string;
    matches?: Array<Record<string, unknown>>;
    count?: number;
    name?: string;
    chain?: string;
    note?: string;
  }

  export interface ClaudeAgentTools {
    sendToMetaAddress(input: SendToMetaAddressInput): Promise<ToolResult>;
    scan(input: ScanInput): Promise<ToolResult>;
    withdraw(input: WithdrawInput): Promise<ToolResult>;
    resolveName(input: ResolveNameInput): Promise<ToolResult>;
  }
}
