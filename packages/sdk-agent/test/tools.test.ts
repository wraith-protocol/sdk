import { describe, expect, test } from 'vitest';
import { createClaudeAgentTools } from '../src/tools';
import { REDACTED_VALUE, type Tracer } from '@wraith-protocol/sdk';
import {
  bytesToHex,
  deriveStealthKeys,
  encodeStealthMetaAddress,
  generateStealthAddress,
} from '@wraith-protocol/sdk/chains/stellar';

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

  test('scan tool omits stealthPrivateScalar and raw metadata by default on matched announcements', async () => {
    const keys = deriveStealthKeys(new Uint8Array(64).fill(0xbb));
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);
    const viewTagHex = stealth.viewTag.toString(16).padStart(2, '0');
    const fullMetadataHex = `${viewTagHex}deadbeefcafebabe001122334455`;

    const scanInput = {
      announcements: [
        {
          schemeId: 1,
          stealthAddress: stealth.stealthAddress,
          caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
          metadata: fullMetadataHex,
        },
      ],
      viewingKeyHex: bytesToHex(keys.viewingKey),
      spendingPubKeyHex: bytesToHex(keys.spendingPubKey),
      spendingScalarHex: keys.spendingScalar.toString(16),
    };

    const safeTools = createClaudeAgentTools();
    const safeResult = await safeTools.scan(scanInput);

    expect(safeResult.count).toBe(1);
    expect(safeResult.matches).toHaveLength(1);
    const match = safeResult.matches![0];
    expect(match.stealthAddress).toBe(stealth.stealthAddress);
    expect(match.ephemeralPubKey).toBe(bytesToHex(stealth.ephemeralPubKey));
    expect(match.schemeId).toBe(1);
    expect(match.viewTag).toBe(viewTagHex);
    expect(match).not.toHaveProperty('stealthPrivateScalar');
    expect(match).not.toHaveProperty('metadata');
    expect(JSON.stringify(safeResult)).not.toContain(fullMetadataHex);

    const optInTools = createClaudeAgentTools({ includeSensitive: true });
    const optInResult = await optInTools.scan(scanInput);
    expect(optInResult.matches![0]).toHaveProperty('stealthPrivateScalar');
    expect(optInResult.matches![0].metadata).toBe(fullMetadataHex);
  });

  test('sendToMetaAddress and withdraw redact accidental secrets in memos and omit raw metadata key by default', async () => {
    const tools = createClaudeAgentTools();
    const keys = deriveStealthKeys(new Uint8Array(64).fill(0xcc));
    const metaAddress = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
    const secretSeed = 'SB77777777777777777777777777777777777777777777777777777A';

    const sendRes = await tools.sendToMetaAddress({
      metaAddress,
      amount: '5',
      memo: `pay with ${secretSeed}`,
    });
    expect(sendRes.tx).not.toHaveProperty('metadata');
    expect(sendRes.tx?.viewTag).toMatch(/^[0-9a-f]{2}$/);
    expect(sendRes.tx?.memo).toBe(`pay with ${REDACTED_VALUE}`);
    expect(JSON.stringify(sendRes)).not.toContain(secretSeed);

    const withdrawRes = await tools.withdraw({
      stealthAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      amount: '5',
      memo: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    });
    expect(withdrawRes.tx?.memo).toBe(`Bearer ${REDACTED_VALUE}`);
  });
});

function makeRecordingTracer() {
  const spanNames: string[] = [];
  const tracer: Tracer = {
    startSpan(name) {
      spanNames.push(name);
      return {
        setAttribute() {},
        recordException() {},
        end() {},
      };
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
