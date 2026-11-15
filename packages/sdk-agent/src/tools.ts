import { redactString, withSpan, type Tracer } from '@wraith-protocol/sdk';
import {
  decodeStealthMetaAddress,
  generateStealthAddress,
  scanAnnouncements,
  hexToBytes,
  bytesToHex,
  type Announcement,
} from '@wraith-protocol/sdk/chains/stellar';

export interface ClaudeAgentToolContext {
  apiKey?: string;
  baseUrl?: string;
  /** Default tracer for spans created by these tools. Overridable per call via `withSpan`-instrumented internals. */
  tracer?: Tracer;
  /**
   * Opt-in flag to include spendable private scalars and raw announcement
   * metadata in `scan` tool results. Defaults to `false` so agent tool
   * outputs never expose sensitive cryptographic material or metadata by default.
   */
  includeSensitive?: boolean;
}

export interface SendToMetaAddressInput {
  metaAddress: string;
  amount: string;
  asset?: string;
  memo?: string;
  destination?: string;
}

export interface ScanInput {
  announcements: Announcement[];
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

function parseHexBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  return hexToBytes(clean);
}

function parseBigInt(value: string | undefined): bigint {
  if (!value) return 0n;
  const clean = value.startsWith('0x') || value.startsWith('0X') ? value : value;
  if (/^0x/i.test(clean)) return BigInt(clean);
  if (/^[0-9]+$/u.test(clean)) return BigInt(clean);
  return BigInt(`0x${clean}`);
}

function extractPublicViewTag(metadata: string): string | undefined {
  const clean = metadata.startsWith('0x') ? metadata.slice(2) : metadata;
  if (clean.length < 2) return undefined;
  const prefix = clean.slice(0, 2).toLowerCase();
  return /^[0-9a-f]{2}$/.test(prefix) ? prefix : undefined;
}

export function createClaudeAgentTools(context: ClaudeAgentToolContext = {}): ClaudeAgentTools {
  const tracer = context.tracer;
  const includeSensitive = context.includeSensitive === true;

  return {
    sendToMetaAddress(input): Promise<ToolResult> {
      return Promise.resolve(
        withSpan(
          'agent.tool.sendToMetaAddress',
          { 'wraith.agent.tool': 'sendToMetaAddress' },
          async () => {
            const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(input.metaAddress);
            const stealthResult = generateStealthAddress(spendingPubKey, viewingPubKey);
            const viewTag = stealthResult.viewTag.toString(16).padStart(2, '0');
            return {
              kind: 'send',
              signingRequired: true,
              metaAddress: input.metaAddress,
              tx: {
                intent: 'send-to-meta-address',
                asset: input.asset ?? 'XLM',
                amount: input.amount,
                memo: input.memo ? redactString(input.memo) : '',
                stealthAddress: stealthResult.stealthAddress,
                ephemeralPubKey: bytesToHex(stealthResult.ephemeralPubKey),
                viewTag,
                ...(includeSensitive ? { metadata: viewTag } : {}),
                destination: input.destination ?? stealthResult.stealthAddress,
              },
              note: 'The agent prepares a stealth send plan. The sender must sign the transaction locally with their wallet.',
            };
          },
          tracer,
        ),
      );
    },

    scan(input): Promise<ToolResult> {
      return Promise.resolve(
        withSpan(
          'agent.tool.scan',
          {
            'wraith.agent.tool': 'scan',
            'wraith.scan.candidate_count': input.announcements.length,
          },
          async () => {
            const viewingKey = parseHexBytes(input.viewingKeyHex);
            const spendingPubKey = parseHexBytes(input.spendingPubKeyHex);
            const spendingScalar = parseBigInt(input.spendingScalarHex);
            const matches = scanAnnouncements(
              input.announcements,
              viewingKey,
              spendingPubKey,
              spendingScalar,
            );
            return {
              kind: 'scan',
              signingRequired: false,
              matches: matches.map((item) => {
                const viewTag = extractPublicViewTag(item.metadata);
                const safeMatch: Record<string, unknown> = {
                  stealthAddress: item.stealthAddress,
                  ephemeralPubKey: item.ephemeralPubKey,
                  schemeId: item.schemeId,
                  ...(viewTag !== undefined ? { viewTag } : {}),
                };
                if (includeSensitive) {
                  safeMatch.metadata = item.metadata;
                  safeMatch.stealthPrivateScalar = item.stealthPrivateScalar.toString();
                }
                return safeMatch;
              }),
              count: matches.length,
            };
          },
          tracer,
        ),
      );
    },

    withdraw(input): Promise<ToolResult> {
      return Promise.resolve(
        withSpan(
          'agent.tool.withdraw',
          { 'wraith.agent.tool': 'withdraw' },
          async () => ({
            kind: 'withdraw',
            signingRequired: true,
            tx: {
              intent: 'withdraw',
              stealthAddress: input.stealthAddress,
              asset: input.asset ?? 'XLM',
              amount: input.amount,
              destination: input.destination ?? input.stealthAddress,
              memo: input.memo ? redactString(input.memo) : '',
            },
            note: 'The agent prepares a withdrawal plan. The stealth account owner must sign the transaction with their local wallet or key manager.',
          }),
          tracer,
        ),
      );
    },

    resolveName(input): Promise<ToolResult> {
      return Promise.resolve(
        withSpan(
          'agent.tool.resolveName',
          { 'wraith.agent.tool': 'resolveName' },
          async () => ({
            kind: 'resolve-name',
            signingRequired: false,
            name: input.name,
            chain: input.chain ?? 'stellar',
            tx: {
              intent: 'resolve-name',
              name: input.name,
              chain: input.chain ?? 'stellar',
            },
          }),
          tracer,
        ),
      );
    },
  };
}
