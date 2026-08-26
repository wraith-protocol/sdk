import { describe, expect, test } from 'vitest';
import { createClaudeAgentTools } from '../../src/agent/tools';
import { deriveStealthKeys } from '../../src/chains/stellar/keys';
import { encodeStealthMetaAddress } from '../../src/chains/stellar/meta-address';
import { type Tracer, type Span } from '../../src/telemetry';

describe('Claude agent tools', () => {
  test('send-to-meta-address builds a signing plan without signing', async () => {
    const tools = createClaudeAgentTools();
    const keys = deriveStealthKeys(new Uint8Array(64).fill(0xaa));
    const metaAddress = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);

    const result = await tools.sendToMetaAddress({
      metaAddress,
      amount: '12.5',
      asset: 'XLM',
      memo: 'agent demo',
    });

    expect(result.kind).toBe('send');
    expect(result.metaAddress).toBe(metaAddress);
    expect(result.signingRequired).toBe(true);
    expect(result.tx).toBeDefined();
  });

  test('scan tool returns matches for a synthetic announcement batch', async () => {
    const tools = createClaudeAgentTools();
    const keys = deriveStealthKeys(new Uint8Array(64).fill(0xaa));
    const stealth = {
      stealthAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      ephemeralPubKey: new Uint8Array(32).fill(0x11),
      viewTag: 7,
    };

    const result = await tools.scan({
      announcements: [
        {
          schemeId: 1,
          stealthAddress: stealth.stealthAddress,
          caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          ephemeralPubKey: '1111111111111111111111111111111111111111111111111111111111111111',
          metadata: '07',
        },
      ],
      viewingKeyHex: Buffer.from(keys.viewingKey).toString('hex'),
      spendingPubKeyHex: Buffer.from(keys.spendingPubKey).toString('hex'),
      spendingScalarHex: keys.spendingScalar.toString(16),
    });

    expect(result.matches).toEqual([]);
    expect(result.count).toBe(0);
  });

  test('withdraw tool builds a withdrawal plan', async () => {
    const tools = createClaudeAgentTools();
    const result = await tools.withdraw({
      stealthAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      amount: '3',
      asset: 'XLM',
      destination: 'GA1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
    });

    expect(result.kind).toBe('withdraw');
    expect(result.signingRequired).toBe(true);
    expect(result.tx).toBeDefined();
  });

  test('resolve-name tool returns a structured resolution payload', async () => {
    const tools = createClaudeAgentTools();
    const result = await tools.resolveName({ name: 'alice', chain: 'stellar' });

    expect(result.kind).toBe('resolve-name');
    expect(result.name).toBe('alice');
    expect(result.chain).toBe('stellar');
  });
});

function makeRecordingTracer() {
  const spanNames: string[] = [];
  const tracer: Tracer = {
    startSpan(name) {
      spanNames.push(name);
      const span: Span = { setAttribute() {}, recordException() {}, end() {} };
      return span;
    },
  };
  return { tracer, spanNames };
}

describe('Claude agent tools telemetry', () => {
  test('each tool method emits its own span when a tracer is configured', async () => {
    const { tracer, spanNames } = makeRecordingTracer();
    const tools = createClaudeAgentTools({ tracer });

    await tools.resolveName({ name: 'alice' });
    await tools.withdraw({
      stealthAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    });

    expect(spanNames).toEqual(['agent.tool.resolveName', 'agent.tool.withdraw']);
  });

  test('no tracer configured means no error and no spans recorded elsewhere', async () => {
    const tools = createClaudeAgentTools();
    await expect(tools.resolveName({ name: 'alice' })).resolves.toBeDefined();
  });
});
