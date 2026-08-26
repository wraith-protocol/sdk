export function createClaudeAgentTools(context?: ClaudeAgentToolContext): ClaudeAgentTools {
  return {} as any;
}

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
