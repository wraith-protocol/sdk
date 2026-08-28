import { deriveStealthKeys } from '../chains/stellar/keys';
import { decodeStealthMetaAddress, encodeStealthMetaAddress } from '../chains/stellar/meta-address';
import { generateStealthAddress } from '../chains/stellar/stealth';
import { scanAnnouncements } from '../chains/stellar/scan';
import { hexToBytes, bytesToHex } from '../chains/stellar/utils';
import type { Announcement } from '../chains/stellar/types';
import { withSpan, type Tracer } from '../telemetry';

export interface ClaudeAgentToolContext {
  apiKey?: string;
  baseUrl?: string;
  /** Default tracer for spans created by these tools. Overridable per call via `withSpan`-instrumented internals. */
  tracer?: Tracer;
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

export function createClaudeAgentTools(context: ClaudeAgentToolContext = {}): ClaudeAgentTools {
  const tracer = context.tracer;

  return {
    sendToMetaAddress(input) {
      return withSpan(
        'agent.tool.sendToMetaAddress',
        { 'wraith.agent.tool': 'sendToMetaAddress' },
        async () => {
          const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(input.metaAddress);
          const stealthResult = generateStealthAddress(spendingPubKey, viewingPubKey);
          return {
            kind: 'send',
            signingRequired: true,
            metaAddress: input.metaAddress,
            tx: {
              intent: 'send-to-meta-address',
              asset: input.asset ?? 'XLM',
              amount: input.amount,
              memo: input.memo ?? '',
              stealthAddress: stealthResult.stealthAddress,
              ephemeralPubKey: bytesToHex(stealthResult.ephemeralPubKey),
              metadata: stealthResult.viewTag.toString(16).padStart(2, '0'),
              destination: input.destination ?? stealthResult.stealthAddress,
            },
            note: 'The agent prepares a stealth send plan. The sender must sign the transaction locally with their wallet.',
          };
        },
        tracer,
      );
    },

    scan(input) {
      return withSpan(
        'agent.tool.scan',
        { 'wraith.agent.tool': 'scan', 'wraith.scan.candidate_count': input.announcements.length },
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
            matches: matches.map((item) => ({
              stealthAddress: item.stealthAddress,
              ephemeralPubKey: item.ephemeralPubKey,
              metadata: item.metadata,
              stealthPrivateScalar: item.stealthPrivateScalar.toString(),
            })),
            count: matches.length,
          };
        },
        tracer,
      );
    },

    withdraw(input) {
      return withSpan(
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
            memo: input.memo ?? '',
          },
          note: 'The agent prepares a withdrawal plan. The stealth account owner must sign the transaction with their local wallet or key manager.',
        }),
        tracer,
      );
    },

    resolveName(input) {
      return withSpan(
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
      );
    },
  };
}
