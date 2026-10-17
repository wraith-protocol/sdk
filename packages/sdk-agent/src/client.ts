import { AgentResponseError, RPCRequestError } from '@wraith-protocol/sdk';
import type {
  WraithConfig,
  AgentConfig,
  AgentInfo,
  AgentStatus,
  ChatResponse,
  ToolCall,
  Balance,
  Payment,
  Notification,
  Conversation,
  RequestOptions,
} from './types';
import { Chain } from './types';

export { AgentResponseError, RPCRequestError };

const DEFAULT_BASE_URL = 'https://api.wraith.dev';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_TIMEOUT_MS = 2_147_483_647;

async function readResponseText(response: Response, url: string): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new AgentResponseError(url, 'body', 'exceeds maximum size');
  }

  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new AgentResponseError(url, 'body', 'exceeds maximum size');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates a raw `/agent/:id/status` response payload at runtime.
 *
 * @param payload Parsed JSON value from the server.
 * @param url Endpoint URL for error diagnostics.
 * @returns Validated {@link AgentStatus}.
 * @throws {AgentResponseError} If the payload is not an object or has invalid `balance` or `tokens`.
 */
export function validateAgentStatus(payload: unknown, url: string): AgentStatus {
  if (!isRecord(payload)) {
    throw new AgentResponseError(url, 'body', 'expected a JSON object');
  }

  if (!isNonEmptyString(payload.balance)) {
    throw new AgentResponseError(url, 'balance', 'must be a non-empty string');
  }

  if (!isRecord(payload.tokens)) {
    throw new AgentResponseError(
      url,
      'tokens',
      'must be an object mapping token symbols to balance strings',
    );
  }

  const tokens: Record<string, string> = {};
  for (const [symbol, amount] of Object.entries(payload.tokens)) {
    if (!isNonEmptyString(symbol)) {
      throw new AgentResponseError(url, 'tokens', 'token symbol must be a non-empty string');
    }
    if (!isNonEmptyString(amount)) {
      throw new AgentResponseError(url, `tokens.${symbol}`, 'must be a non-empty string');
    }
    tokens[symbol] = amount;
  }

  return {
    balance: payload.balance,
    tokens,
  };
}

/**
 * Validates a single stealth payment record at runtime.
 *
 * @param payload Candidate payment record.
 * @param url Endpoint URL for error diagnostics.
 * @param field Field path within the response.
 * @returns Validated {@link Payment}.
 * @throws {AgentResponseError} If any required field is missing or not a non-empty string.
 */
export function validatePayment(payload: unknown, url: string, field = 'payment'): Payment {
  if (!isRecord(payload)) {
    throw new AgentResponseError(url, field, 'payment record must be an object');
  }

  if (!isNonEmptyString(payload.stealthAddress)) {
    throw new AgentResponseError(url, `${field}.stealthAddress`, 'must be a non-empty string');
  }

  if (!isNonEmptyString(payload.balance)) {
    throw new AgentResponseError(url, `${field}.balance`, 'must be a non-empty string');
  }

  if (!isNonEmptyString(payload.ephemeralPubKey)) {
    throw new AgentResponseError(url, `${field}.ephemeralPubKey`, 'must be a non-empty string');
  }

  return {
    stealthAddress: payload.stealthAddress,
    balance: payload.balance,
    ephemeralPubKey: payload.ephemeralPubKey,
  };
}

/**
 * Parses and validates a `scan_payments` tool-call `detail` JSON payload into {@link Payment} records.
 *
 * @param detail Raw `detail` field from a `scan_payments` tool call.
 * @param url Endpoint URL for error diagnostics.
 * @param field Field path for the tool call's `detail` property.
 * @returns Validated array of {@link Payment} records.
 * @throws {AgentResponseError} If `detail` is missing, invalid JSON, not an array, or contains invalid records.
 */
export function parseToolCallPayments(detail: unknown, url: string, field = 'detail'): Payment[] {
  if (!isNonEmptyString(detail)) {
    throw new AgentResponseError(url, field, 'must be a non-empty JSON string');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    throw new AgentResponseError(url, field, 'not valid JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new AgentResponseError(url, field, 'expected a JSON array of payment records');
  }

  return parsed.map((entry, index) => validatePayment(entry, url, `${field}[${index}]`));
}

function validateToolCall(payload: unknown, url: string, field: string): ToolCall {
  if (!isRecord(payload)) {
    throw new AgentResponseError(url, field, 'tool call must be an object');
  }

  if (!isNonEmptyString(payload.name)) {
    throw new AgentResponseError(url, `${field}.name`, 'must be a non-empty string');
  }

  if (!isNonEmptyString(payload.status)) {
    throw new AgentResponseError(url, `${field}.status`, 'must be a non-empty string');
  }

  if (payload.detail !== undefined && typeof payload.detail !== 'string') {
    throw new AgentResponseError(url, `${field}.detail`, 'must be a string when present');
  }

  return {
    name: payload.name,
    status: payload.status,
    ...(payload.detail !== undefined ? { detail: payload.detail } : {}),
  };
}

function validateChatResponse(payload: unknown, url: string): ChatResponse {
  if (!isRecord(payload)) {
    throw new AgentResponseError(url, 'body', 'expected a JSON object');
  }

  if (typeof payload.response !== 'string') {
    throw new AgentResponseError(url, 'response', 'must be a string');
  }

  if (!isNonEmptyString(payload.conversationId)) {
    throw new AgentResponseError(url, 'conversationId', 'must be a non-empty string');
  }

  let toolCalls: ToolCall[] | undefined;
  if (payload.toolCalls !== undefined) {
    if (!Array.isArray(payload.toolCalls)) {
      throw new AgentResponseError(url, 'toolCalls', 'must be an array');
    }
    toolCalls = payload.toolCalls.map((tc, index) =>
      validateToolCall(tc, url, `toolCalls[${index}]`),
    );
  }

  return {
    response: payload.response,
    ...(toolCalls !== undefined ? { toolCalls } : {}),
    conversationId: payload.conversationId,
  };
}

export class Wraith {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly aiConfig?: { provider: string; apiKey: string };

  constructor(config: WraithConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (
      !Number.isFinite(this.timeoutMs) ||
      this.timeoutMs <= 0 ||
      this.timeoutMs > MAX_TIMEOUT_MS
    ) {
      throw new RangeError(`timeoutMs must be between 0 and ${MAX_TIMEOUT_MS}`);
    }
    this.aiConfig = config.ai;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) {
      abortFromCaller();
    } else {
      options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    }
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
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
        signal: controller.signal,
      });

      if (!res.ok) {
        await res.body?.cancel();
        throw new RPCRequestError(url, res.status);
      }

      const text = await readResponseText(res, url);
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new AgentResponseError(url, 'body', 'not valid JSON');
      }
    } catch (error) {
      if (timedOut) throw new Error(`Request timed out after ${this.timeoutMs}ms`);
      throw error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  /**
   * Creates a new stealth address AI agent.
   *
   * @param config Configuration for the agent name, chains, signature, and wallet.
   * @returns A WraithAgent instance to control the new agent.
   * @throws {RPCRequestError} If the server returns a non-2xx status code.
   */
  async createAgent(config: AgentConfig, options?: RequestOptions): Promise<WraithAgent> {
    const info = await this.request<AgentInfo>('POST', '/agent/create', config, options);
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
  async getAgentByWallet(walletAddress: string, options?: RequestOptions): Promise<WraithAgent> {
    const info = await this.request<AgentInfo>(
      'GET',
      `/agent/wallet/${walletAddress}`,
      undefined,
      options,
    );
    return new WraithAgent(this, info);
  }

  /**
   * Retrieves a WraithAgent instance by their registered name (e.g. alice.wraith).
   *
   * @param name The agent name.
   * @returns A WraithAgent instance.
   * @throws {RPCRequestError} If the server returns a non-2xx status code.
   */
  async getAgentByName(name: string, options?: RequestOptions): Promise<WraithAgent> {
    const info = await this.request<AgentInfo>('GET', `/agent/info/${name}`, undefined, options);
    return new WraithAgent(this, info);
  }

  /**
   * Lists all stealth address AI agents associated with the user's API key.
   *
   * @returns List of AgentInfo objects.
   * @throws {RPCRequestError} If the server returns a non-2xx status code.
   */
  async listAgents(options?: RequestOptions): Promise<AgentInfo[]> {
    return this.request<AgentInfo[]>('GET', '/agents', undefined, options);
  }

  /** @internal Exposed for WraithAgent to use. */
  _request<T>(method: string, path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(method, path, body, options);
  }

  /** @internal Returns the normalized base URL for error reporting. */
  _getBaseUrl(): string {
    return this.baseUrl;
  }
}

export class WraithAgent {
  readonly info: AgentInfo;
  private readonly wraith: Wraith;

  constructor(wraith: Wraith, info: AgentInfo) {
    this.wraith = wraith;
    this.info = info;
  }

  private req<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return this.wraith._request<T>(method, `/agent/${this.info.id}${path}`, body, options);
  }

  private endpointUrl(path: string): string {
    return `${this.wraith._getBaseUrl()}/agent/${this.info.id}${path}`;
  }

  async chat(
    message: string,
    conversationId?: string,
    options?: RequestOptions,
  ): Promise<ChatResponse> {
    const path = '/chat';
    const data = await this.req<unknown>('POST', path, { message, conversationId }, options);
    return validateChatResponse(data, this.endpointUrl(path));
  }

  async getStatus(options?: RequestOptions): Promise<AgentStatus> {
    const path = '/status';
    const data = await this.req<unknown>('GET', path, undefined, options);
    return validateAgentStatus(data, this.endpointUrl(path));
  }

  async getBalance(options?: RequestOptions): Promise<Balance> {
    const status = await this.getStatus(options);
    return { native: status.balance, tokens: status.tokens };
  }

  async scanPayments(options?: RequestOptions): Promise<Payment[]> {
    const url = this.endpointUrl('/chat');
    const res = await this.chat('Scan for incoming stealth payments', undefined, options);
    const payments: Payment[] = [];

    for (const [index, tc] of (res.toolCalls ?? []).entries()) {
      if (tc.name !== 'scan_payments') continue;
      payments.push(...parseToolCallPayments(tc.detail, url, `toolCalls[${index}].detail`));
    }

    return payments;
  }

  async exportKey(
    signature: string,
    message: string,
    options?: RequestOptions,
  ): Promise<{ secret: string }> {
    return this.req<{ secret: string }>('POST', '/export', { signature, message }, options);
  }

  async getConversations(options?: RequestOptions): Promise<Conversation[]> {
    return this.req<Conversation[]>('GET', '/conversations', undefined, options);
  }

  async getMessages(
    conversationId: string,
    options?: RequestOptions,
  ): Promise<Array<{ role: string; text: string }>> {
    return this.req('GET', `/conversations/${conversationId}/messages`, undefined, options);
  }

  async deleteConversation(conversationId: string, options?: RequestOptions): Promise<void> {
    await this.req('DELETE', `/conversations/${conversationId}`, undefined, options);
  }

  async getNotifications(
    options?: RequestOptions,
  ): Promise<{ notifications: Notification[]; unreadCount: number }> {
    return this.req('GET', '/notifications', undefined, options);
  }

  async markNotificationsRead(options?: RequestOptions): Promise<void> {
    await this.req('POST', '/notifications/read', {}, options);
  }

  async clearNotifications(options?: RequestOptions): Promise<void> {
    await this.req('DELETE', '/notifications', undefined, options);
  }
}
