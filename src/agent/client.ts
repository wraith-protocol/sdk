import { RPCRequestError } from '../errors';
import type {
  WraithConfig,
  AgentConfig,
  AgentInfo,
  ChatResponse,
  Balance,
  Payment,
  Notification,
  Conversation,
} from './types';
import { Chain } from './types';

const DEFAULT_BASE_URL = 'https://api.wraith.dev';

export class Wraith {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly aiConfig?: { provider: string; apiKey: string };

  constructor(config: WraithConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.aiConfig = config.ai;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        ...(this.aiConfig
          ? { 'X-AI-Provider': this.aiConfig.provider, 'X-AI-Key': this.aiConfig.apiKey }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new RPCRequestError(url, res.status, error.message || res.statusText);
    }

    return res.json();
  }

  /**
   * Creates a new stealth address AI agent.
   *
   * @param config Configuration for the agent name, chains, signature, and wallet.
   * @returns A WraithAgent instance to control the new agent.
   * @throws {RPCRequestError} If the server returns a non-2xx status code.
   */
  async createAgent(config: AgentConfig): Promise<WraithAgent> {
    const info = await this.request<AgentInfo>('POST', '/agent/create', config);
    return new WraithAgent(this, info);
  }

  agent(agentId: string): WraithAgent {
    return new WraithAgent(this, {
      id: agentId,
      name: '',
      chains: [],
      addresses: {} as Record<Chain, string>,
      metaAddresses: {} as Record<Chain, string>,
    });
  }

  /**
   * Retrieves a WraithAgent instance by their associated wallet address.
   *
   * @param walletAddress The base wallet address of the agent owner.
   * @returns A WraithAgent instance.
   * @throws {RPCRequestError} If the server returns a non-2xx status code.
   */
  async getAgentByWallet(walletAddress: string): Promise<WraithAgent> {
    const info = await this.request<AgentInfo>('GET', `/agent/wallet/${walletAddress}`);
    return new WraithAgent(this, info);
  }

  /**
   * Retrieves a WraithAgent instance by their registered name (e.g. alice.wraith).
   *
   * @param name The agent name.
   * @returns A WraithAgent instance.
   * @throws {RPCRequestError} If the server returns a non-2xx status code.
   */
  async getAgentByName(name: string): Promise<WraithAgent> {
    const info = await this.request<AgentInfo>('GET', `/agent/info/${name}`);
    return new WraithAgent(this, info);
  }

  /**
   * Lists all stealth address AI agents associated with the user's API key.
   *
   * @returns List of AgentInfo objects.
   * @throws {RPCRequestError} If the server returns a non-2xx status code.
   */
  async listAgents(): Promise<AgentInfo[]> {
    return this.request<AgentInfo[]>('GET', '/agents');
  }

  /** @internal Exposed for WraithAgent to use. */
  _request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.request<T>(method, path, body);
  }
}

export class WraithAgent {
  readonly info: AgentInfo;
  private readonly wraith: Wraith;

  constructor(wraith: Wraith, info: AgentInfo) {
    this.wraith = wraith;
    this.info = info;
  }

  private req<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.wraith._request<T>(method, `/agent/${this.info.id}${path}`, body);
  }

  async chat(message: string, conversationId?: string): Promise<ChatResponse> {
    return this.req<ChatResponse>('POST', '/chat', { message, conversationId });
  }

  async getStatus(): Promise<any> {
    return this.req('GET', '/status');
  }

  async getBalance(): Promise<Balance> {
    const status = await this.getStatus();
    return { native: status.balance || '0', tokens: status.tokens || {} };
  }

  async scanPayments(): Promise<Payment[]> {
    const res = await this.chat('Scan for incoming stealth payments');
    return (res.toolCalls || [])
      .filter((tc) => tc.name === 'scan_payments')
      .flatMap((tc) => {
        try {
          return JSON.parse(tc.detail || '[]');
        } catch {
          return [];
        }
      });
  }

  async exportKey(signature: string, message: string): Promise<{ secret: string }> {
    return this.req<{ secret: string }>('POST', '/export', { signature, message });
  }

  async getConversations(): Promise<Conversation[]> {
    return this.req<Conversation[]>('GET', '/conversations');
  }

  async getMessages(conversationId: string): Promise<Array<{ role: string; text: string }>> {
    return this.req('GET', `/conversations/${conversationId}/messages`);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.req('DELETE', `/conversations/${conversationId}`);
  }

  async getNotifications(): Promise<{ notifications: Notification[]; unreadCount: number }> {
    return this.req('GET', '/notifications');
  }

  async markNotificationsRead(): Promise<void> {
    await this.req('POST', '/notifications/read', {});
  }

  async clearNotifications(): Promise<void> {
    await this.req('DELETE', '/notifications');
  }
}
