import { afterEach, describe, expect, test } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import {
  REDACTED_VALUE,
  isSensitiveFieldName,
  redactUrl,
  redactString,
  redactValue,
  redactError,
  sanitizeTelemetryAttributeValue,
  sanitizeTelemetryAttributes,
  sanitizeTelemetryException,
  setTracer,
  withSpan,
  startSafeSpan,
  createSafeTracer,
  getUnknownErrorMessage,
  InvalidSignatureError,
  InvalidScalarError,
  RPCRequestError,
  HorizonResponseError,
  AgentResponseError,
  RPCRetryExhaustedError,
  RPCTimeoutError,
  RPCAbortedError,
  WalletRequestFailedError,
  type Tracer,
  type Span,
} from '../src';
import { KeyVault } from '../src/vault';
import { createRpcClient } from '../src/chains/stellar/rpc';
import { scanAnnouncementsStream } from '../src/chains/stellar/scan';
import { deriveStealthKeys, generateStealthAddress, bytesToHex } from '../src/chains/stellar';

const SECRET_CORPUS = {
  viewingKeyHex: '0x' + 'a1'.repeat(32),
  spendingKeyHex: '0x' + 'b2'.repeat(32),
  spendingScalarDec:
    '21888242871839275222246405745257275088548364400416034343698204186575808495617',
  stellarSecretSeed: 'SB77777777777777777777777777777777777777777777777777777A',
  solanaSecretBase58:
    '4wBqpZM9xaSheZzJSMawUHDgZ7miWfSsxmfVF5jJpYP2Xk9V2sY8cK1n2Q3r4T5u6V7w8X9yZaBcDeFgHiJkLmNo',
  mnemonic12:
    'abandon ability able about above absent absorb abstract absurd abuse access accident',
  evmSignatureHex: '0x' + 'cd'.repeat(65),
  stellarSignatureHex: 'ef'.repeat(64),
  bearerToken:
    'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbGljZSIsInJvbGUiOiJvd25lciJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
  wraithApiKey: 'wraith_live_9f8e7d6c5b4a3210secret',
  aiProviderKey: 'sk-ant-api03-supersecretproviderkey123456',
  rpcUrlWithCreds:
    'https://rpcuser:supersecretpass@soroban-rpc.example.com:8443/v1/api-key/secretPathKey999/events?api_key=querySecret123&network=testnet&limit=50#access_token=fragSecret456',
  vaultEnvelope: {
    key: 'vault',
    salt: 'c2FsdC1iYXNlNjQtc2VjcmV0',
    iv: 'aXYtYmFzZTY0LXNlY3JldA==',
    checkIv: 'Y2hlY2staXYtc2VjcmV0',
    ciphertext: 'Y2lwaGVydGV4dC1wYXlsb2FkLXNlY3JldA==',
    checkCiphertext: 'Y2hlY2stY2lwaGVydGV4dC1zZWNyZXQ=',
    authTag: 'YXV0aC10YWctc2VjcmV0',
    iterations: 210_000,
  },
  vaultTypedBytes: {
    __vaultType: 'Uint8Array',
    data: 'AAECAwQFBgcICQoLDA0ODw==',
  },
  decryptedMetadata: {
    invoiceId: 'inv-9981',
    payerNote: 'private-payroll-october',
    memoSecret: 'confidential-salary',
  },
  rawAnnouncementMetadata: '07deadbeefcafebabe00112233445566778899aabbccddeeff',
} as const;

const SAFE_OPERATIONAL_CONTEXT = {
  stellarAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
  evmAddress: '0x1234567890abcdef1234567890abcdef12345678',
  stellarMetaAddress: `st:xlm:${'11'.repeat(64)}`,
  evmMetaAddress: `st:eth:0x${'22'.repeat(66)}`,
  txHash: '0x' + '99'.repeat(32),
  ephemeralPubKey: '33'.repeat(32),
  spendingPubKey: '44'.repeat(32),
} as const;

describe('Central secret redaction policy (secret corpus)', () => {
  afterEach(() => {
    setTracer(null);
  });

  test('redacts the full secret corpus while preserving public operational context', () => {
    const complexPayload = {
      chain: 'stellar',
      network: 'testnet',
      stealthAddress: SAFE_OPERATIONAL_CONTEXT.stellarAddress,
      metaAddress: SAFE_OPERATIONAL_CONTEXT.stellarMetaAddress,
      evmMetaAddress: SAFE_OPERATIONAL_CONTEXT.evmMetaAddress,
      txHash: SAFE_OPERATIONAL_CONTEXT.txHash,
      ephemeralPubKey: SAFE_OPERATIONAL_CONTEXT.ephemeralPubKey,
      spendingPubKey: SAFE_OPERATIONAL_CONTEXT.spendingPubKey,
      tokens: { XLM: '125.50', USDC: '40.00' },
      keys: {
        viewingKey: SECRET_CORPUS.viewingKeyHex,
        spendingKey: SECRET_CORPUS.spendingKeyHex,
        spendingScalar: SECRET_CORPUS.spendingScalarDec,
        rawSeedBytes: new Uint8Array([9, 8, 7, 6]),
      },
      seeds: {
        stellarSeed: SECRET_CORPUS.stellarSecretSeed,
        mnemonic: SECRET_CORPUS.mnemonic12,
        unlabeledLog: `Loaded signer ${SECRET_CORPUS.stellarSecretSeed} and keypair ${SECRET_CORPUS.solanaSecretBase58}`,
      },
      signatures: {
        signature: SECRET_CORPUS.evmSignatureHex,
        inlineSig: `Failed verifying ${SECRET_CORPUS.stellarSignatureHex} on txHash=${SAFE_OPERATIONAL_CONTEXT.txHash}`,
      },
      auth: {
        authorization: SECRET_CORPUS.bearerToken,
        apiKey: SECRET_CORPUS.wraithApiKey,
        'x-ai-key': SECRET_CORPUS.aiProviderKey,
        inlineHeader: `Header Authorization: ${SECRET_CORPUS.bearerToken} key=${SECRET_CORPUS.wraithApiKey}`,
      },
      rpc: {
        url: SECRET_CORPUS.rpcUrlWithCreds,
        logLine: `POST ${SECRET_CORPUS.rpcUrlWithCreds} failed with status 502`,
      },
      vault: {
        ...SECRET_CORPUS.vaultEnvelope,
        encodedKey: SECRET_CORPUS.vaultTypedBytes,
      },
      metadata: SECRET_CORPUS.rawAnnouncementMetadata,
      decryptedMetadata: SECRET_CORPUS.decryptedMetadata,
    };

    const redacted = redactValue(complexPayload) as Record<string, any>;
    const serialized = JSON.stringify(redacted);

    // Every secret in the corpus must be absent from serialized output
    expect(serialized).not.toContain(SECRET_CORPUS.viewingKeyHex);
    expect(serialized).not.toContain(SECRET_CORPUS.spendingKeyHex);
    expect(serialized).not.toContain(SECRET_CORPUS.spendingScalarDec);
    expect(serialized).not.toContain(SECRET_CORPUS.stellarSecretSeed);
    expect(serialized).not.toContain(SECRET_CORPUS.solanaSecretBase58);
    expect(serialized).not.toContain('abandon ability');
    expect(serialized).not.toContain(SECRET_CORPUS.evmSignatureHex);
    expect(serialized).not.toContain(SECRET_CORPUS.stellarSignatureHex);
    expect(serialized).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(serialized).not.toContain(SECRET_CORPUS.wraithApiKey);
    expect(serialized).not.toContain(SECRET_CORPUS.aiProviderKey);
    expect(serialized).not.toContain('supersecretpass');
    expect(serialized).not.toContain('secretPathKey999');
    expect(serialized).not.toContain('querySecret123');
    expect(serialized).not.toContain('fragSecret456');
    expect(serialized).not.toContain(SECRET_CORPUS.vaultEnvelope.salt);
    expect(serialized).not.toContain(SECRET_CORPUS.vaultEnvelope.iv);
    expect(serialized).not.toContain(SECRET_CORPUS.vaultEnvelope.checkIv);
    expect(serialized).not.toContain(SECRET_CORPUS.vaultEnvelope.ciphertext);
    expect(serialized).not.toContain(SECRET_CORPUS.vaultEnvelope.checkCiphertext);
    expect(serialized).not.toContain(SECRET_CORPUS.vaultEnvelope.authTag);
    expect(serialized).not.toContain(SECRET_CORPUS.vaultTypedBytes.data);
    expect(serialized).not.toContain('private-payroll-october');
    expect(serialized).not.toContain('confidential-salary');
    expect(serialized).not.toContain(SECRET_CORPUS.rawAnnouncementMetadata);

    // Useful operational context is preserved intact
    expect(redacted.chain).toBe('stellar');
    expect(redacted.network).toBe('testnet');
    expect(redacted.stealthAddress).toBe(SAFE_OPERATIONAL_CONTEXT.stellarAddress);
    expect(redacted.metaAddress).toBe(SAFE_OPERATIONAL_CONTEXT.stellarMetaAddress);
    expect(redacted.evmMetaAddress).toBe(SAFE_OPERATIONAL_CONTEXT.evmMetaAddress);
    expect(redacted.txHash).toBe(SAFE_OPERATIONAL_CONTEXT.txHash);
    expect(redacted.ephemeralPubKey).toBe(SAFE_OPERATIONAL_CONTEXT.ephemeralPubKey);
    expect(redacted.spendingPubKey).toBe(SAFE_OPERATIONAL_CONTEXT.spendingPubKey);
    expect(redacted.tokens).toEqual({ XLM: '125.50', USDC: '40.00' });
    expect(redacted.vault.iterations).toBe(210_000);
    expect(redacted.vault.encodedKey).toEqual({
      __vaultType: 'Uint8Array',
      data: REDACTED_VALUE,
    });
    expect(redacted.rpc.url).toBe(
      'https://[REDACTED]@soroban-rpc.example.com:8443/v1/api-key/[REDACTED]/events?api_key=[REDACTED]&network=testnet&limit=50#access_token=[REDACTED]',
    );
    expect(redacted.signatures.inlineSig).toContain(`txHash=${SAFE_OPERATIONAL_CONTEXT.txHash}`);
  });

  test('redaction is deterministic, handles circular references, and caps depth', () => {
    const first = redactValue(SECRET_CORPUS);
    const second = redactValue(SECRET_CORPUS);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));

    const circular: Record<string, unknown> = {
      endpoint: 'https://user:pass@rpc.wraith.dev',
      viewingKey: SECRET_CORPUS.viewingKeyHex,
    };
    circular.self = circular;

    const safeCircular = redactValue(circular) as Record<string, unknown>;
    expect(safeCircular.endpoint).toBe('https://[REDACTED]@rpc.wraith.dev');
    expect(safeCircular.viewingKey).toBe(REDACTED_VALUE);
    expect(safeCircular.self).toBe('[Circular]');

    const deep = { a: { b: { c: { d: { secretKey: 'top-secret' } } } } };
    expect(redactValue(deep, { maxDepth: 2 })).toEqual({
      a: { b: '[MaxDepth]' },
    });
  });

  test('redactString handles inline mnemonics, PEM blocks, and labeled secrets while keeping meta-addresses', () => {
    const pem = [
      '-----BEGIN PRIVATE KEY-----',
      'MC4CAQAwBQYDK2VwBCIEIJV5e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4',
      '-----END PRIVATE KEY-----',
    ].join('\n');

    const input = [
      `Target=${SAFE_OPERATIONAL_CONTEXT.stellarMetaAddress}`,
      `mnemonic: ${SECRET_CORPUS.mnemonic12}`,
      `decryptedMetadata="invoice:secret-42"`,
      pem,
    ].join(' | ');

    const out = redactString(input);
    expect(out).toContain(SAFE_OPERATIONAL_CONTEXT.stellarMetaAddress);
    expect(out).not.toContain('abandon ability');
    expect(out).not.toContain('invoice:secret-42');
    expect(out).not.toContain('MC4CAQAwBQYDK2Vw');
    expect(out).toContain(`mnemonic: ${REDACTED_VALUE}`);
  });

  test('isSensitiveFieldName distinguishes sensitive fields from public and operational fields', () => {
    expect(isSensitiveFieldName('viewingKey')).toBe(true);
    expect(isSensitiveFieldName('spendingScalar')).toBe(true);
    expect(isSensitiveFieldName('stealthPrivateScalar')).toBe(true);
    expect(isSensitiveFieldName('authorization')).toBe(true);
    expect(isSensitiveFieldName('checkCiphertext')).toBe(true);
    expect(isSensitiveFieldName('decryptedMetadata')).toBe(true);
    expect(isSensitiveFieldName('metadata')).toBe(true);

    expect(isSensitiveFieldName('viewingPubKey')).toBe(false);
    expect(isSensitiveFieldName('spendingPubKey')).toBe(false);
    expect(isSensitiveFieldName('ephemeralPubKey')).toBe(false);
    expect(isSensitiveFieldName('stealthAddress')).toBe(false);
    expect(isSensitiveFieldName('metaAddress')).toBe(false);
    expect(isSensitiveFieldName('tokens')).toBe(false);
    expect(isSensitiveFieldName('viewTag')).toBe(false);
  });

  test('redactUrl preserves clean origins without adding trailing slashes', () => {
    expect(redactUrl('https://horizon.stellar.org')).toBe('https://horizon.stellar.org');
    expect(redactUrl('https://user:secret@horizon.stellar.org')).toBe(
      'https://[REDACTED]@horizon.stellar.org',
    );
    expect(redactUrl('/v1/rpc?api_key=abc123&ledger=99')).toBe(
      '/v1/rpc?api_key=[REDACTED]&ledger=99',
    );
  });
});

describe('Error serialization and getUnknownErrorMessage redaction', () => {
  test('WraithError subclasses redact secrets in toJSON() and network/wallet constructors', () => {
    const sigErr = new InvalidSignatureError(SECRET_CORPUS.evmSignatureHex, 65, 65);
    const sigJson = JSON.parse(JSON.stringify(sigErr));
    expect(sigJson.code).toBe('WRAITH/INPUT/INVALID_SIGNATURE');
    expect(sigJson.context).toEqual({
      signature: REDACTED_VALUE,
      expectedLength: 65,
      actualLength: 65,
    });
    expect(JSON.stringify(sigJson)).not.toContain(SECRET_CORPUS.evmSignatureHex);

    const shortSigErr = new InvalidSignatureError('raw-base64-sig-payload', 64, 16);
    const shortSigJson = shortSigErr.toJSON();
    expect(shortSigJson.context?.signature).toBe(REDACTED_VALUE);
    expect(shortSigJson.message).not.toContain('raw-base64-sig-payload');
    expect(shortSigJson.message).toContain(`"${REDACTED_VALUE}"`);

    const scalarErr = new InvalidScalarError(
      BigInt(SECRET_CORPUS.spendingScalarDec),
      'out of range',
    );
    const scalarJson = JSON.parse(JSON.stringify(scalarErr));
    expect(scalarJson.context).toEqual({
      scalar: REDACTED_VALUE,
      reason: 'out of range',
    });
    expect(scalarJson.message).not.toContain(SECRET_CORPUS.spendingScalarDec);

    const rpcErr = new RPCRequestError(
      SECRET_CORPUS.rpcUrlWithCreds,
      401,
      `Unauthorized for ${SECRET_CORPUS.bearerToken}`,
    );
    expect(rpcErr.message).not.toContain('supersecretpass');
    expect(rpcErr.message).not.toContain('querySecret123');
    expect(rpcErr.message).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(rpcErr.describe()).not.toContain('supersecretpass');
    expect(rpcErr.statusCode).toBe(401);

    const timeoutErr = new RPCTimeoutError({
      url: SECRET_CORPUS.rpcUrlWithCreds,
      endpoint: 'https://rpcuser:supersecretpass@soroban-rpc.example.com:8443',
      attempt: 2,
      phase: 'request',
      timeoutMs: 5000,
    });
    expect(timeoutErr.url).not.toContain('supersecretpass');
    expect(timeoutErr.endpoint).toBe('https://[REDACTED]@soroban-rpc.example.com:8443');
    expect(timeoutErr.describe()).not.toContain('supersecretpass');

    const retryErr = new RPCRetryExhaustedError(
      SECRET_CORPUS.rpcUrlWithCreds,
      3,
      `seed=${SECRET_CORPUS.stellarSecretSeed}`,
    );
    expect(retryErr.message).not.toContain('querySecret123');
    expect(retryErr.message).not.toContain(SECRET_CORPUS.stellarSecretSeed);

    const horizonErr = new HorizonResponseError(
      SECRET_CORPUS.rpcUrlWithCreds,
      '_embedded.records',
      `token=${SECRET_CORPUS.wraithApiKey}`,
    );
    expect(horizonErr.message).not.toContain('querySecret123');
    expect(horizonErr.message).not.toContain(SECRET_CORPUS.wraithApiKey);

    const agentErr = new AgentResponseError(
      'https://api.wraith.dev/agent/1/chat?api_key=leak123',
      'toolCalls[0]',
      `viewingKey=${SECRET_CORPUS.viewingKeyHex}`,
    );
    expect(agentErr.message).not.toContain('leak123');
    expect(agentErr.message).not.toContain(SECRET_CORPUS.viewingKeyHex);

    const abortErr = new RPCAbortedError(SECRET_CORPUS.rpcUrlWithCreds);
    expect(abortErr.url).not.toContain('supersecretpass');

    const walletErr = new WalletRequestFailedError({
      chain: 'stellar',
      reason: `Signer rejected secret ${SECRET_CORPUS.stellarSecretSeed}`,
      providerCode: -32603,
      cause: { privateKey: SECRET_CORPUS.viewingKeyHex },
    });
    expect(walletErr.message).not.toContain(SECRET_CORPUS.stellarSecretSeed);
    expect(JSON.stringify(walletErr)).not.toContain(SECRET_CORPUS.viewingKeyHex);
  });

  test('getUnknownErrorMessage redacts Error instances, strings, and plain objects', () => {
    expect(getUnknownErrorMessage(new Error(`Auth failed: ${SECRET_CORPUS.bearerToken}`))).toBe(
      `Auth failed: Bearer ${REDACTED_VALUE}`,
    );
    expect(getUnknownErrorMessage(`Seed=${SECRET_CORPUS.stellarSecretSeed}`)).toBe(
      `Seed=${REDACTED_VALUE}`,
    );
    const objMsg = getUnknownErrorMessage({
      status: 500,
      viewingKey: SECRET_CORPUS.viewingKeyHex,
      metadata: '07aa11',
    });
    expect(objMsg).not.toContain(SECRET_CORPUS.viewingKeyHex);
    expect(objMsg).not.toContain('07aa11');
    expect(objMsg).toContain('"status":500');
  });

  test('redactError strips undocumented provider fields from plain Error instances', () => {
    const providerErr = Object.assign(new Error(`RPC failed at ${SECRET_CORPUS.rpcUrlWithCreds}`), {
      code: 'ECONNRESET',
      privateKey: SECRET_CORPUS.viewingKeyHex,
      headers: { Authorization: SECRET_CORPUS.bearerToken },
    });
    const snap = redactError(providerErr);
    expect(snap.name).toBe('Error');
    expect(snap.code).toBe('ECONNRESET');
    expect(snap.message).not.toContain('supersecretpass');
    expect(JSON.stringify(snap)).not.toContain(SECRET_CORPUS.viewingKeyHex);
    expect(JSON.stringify(snap)).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });
});

describe('Telemetry safe-shape guarantees', () => {
  afterEach(() => {
    setTracer(null);
  });

  function createCapturingTracer() {
    const captured: Array<{
      name: string;
      initialAttributes: Record<string, string | number | boolean> | undefined;
      dynamicAttributes: Record<string, string | number | boolean>;
      exceptions: unknown[];
      endedCount: number;
    }> = [];

    const tracer: Tracer = {
      startSpan(name, attributes) {
        const entry = {
          name,
          initialAttributes: attributes,
          dynamicAttributes: {} as Record<string, string | number | boolean>,
          exceptions: [] as unknown[],
          endedCount: 0,
        };
        captured.push(entry);
        const span: Span = {
          setAttribute(key, value) {
            entry.dynamicAttributes[key] = value;
          },
          recordException(error) {
            entry.exceptions.push(error);
          },
          end() {
            entry.endedCount += 1;
          },
        };
        return span;
      },
    };

    return { tracer, captured };
  }

  test('withSpan, startSafeSpan, and createSafeTracer deliver only documented safe shapes to user hooks', async () => {
    const { tracer, captured } = createCapturingTracer();
    setTracer(tracer);

    const leakyError = Object.assign(
      new RPCRequestError(
        SECRET_CORPUS.rpcUrlWithCreds,
        502,
        `upstream bearer ${SECRET_CORPUS.bearerToken}`,
      ),
      {
        viewingKey: SECRET_CORPUS.viewingKeyHex,
        headers: { Authorization: SECRET_CORPUS.bearerToken },
        cause: { mnemonic: SECRET_CORPUS.mnemonic12 },
      },
    );

    await expect(
      withSpan(
        `rpc.call ${SECRET_CORPUS.wraithApiKey}`,
        {
          'wraith.chain': 'stellar',
          'wraith.rpc.endpoint': SECRET_CORPUS.rpcUrlWithCreds,
          viewingKey: SECRET_CORPUS.viewingKeyHex,
          attempt: 1,
          ok: false,
        },
        async (span) => {
          span.setAttribute('authorization', SECRET_CORPUS.bearerToken);
          span.setAttribute('wraith.rpc.path', '/v1/events?api_key=pathSecret789&limit=10');
          span.setAttribute('txHash', SAFE_OPERATIONAL_CONTEXT.txHash);
          throw leakyError;
        },
      ),
    ).rejects.toBe(leakyError);

    expect(captured).toHaveLength(1);
    const spanRecord = captured[0];
    expect(spanRecord.endedCount).toBe(1);
    expect(spanRecord.name).toBe(`rpc.call ${REDACTED_VALUE}`);
    expect(spanRecord.initialAttributes).toEqual({
      'wraith.chain': 'stellar',
      'wraith.rpc.endpoint':
        'https://[REDACTED]@soroban-rpc.example.com:8443/v1/api-key/[REDACTED]/events?api_key=[REDACTED]&network=testnet&limit=50#access_token=[REDACTED]',
      viewingKey: REDACTED_VALUE,
      attempt: 1,
      ok: false,
    });
    expect(spanRecord.dynamicAttributes).toEqual({
      authorization: REDACTED_VALUE,
      'wraith.rpc.path': '/v1/events?api_key=[REDACTED]&limit=10',
      txHash: SAFE_OPERATIONAL_CONTEXT.txHash,
    });

    expect(spanRecord.exceptions).toHaveLength(1);
    const recordedErr = spanRecord.exceptions[0] as Error & Record<string, unknown>;
    expect(recordedErr).toBeInstanceOf(Error);
    expect(recordedErr.name).toBe('RPCRequestError');
    expect(recordedErr.code).toBe('WRAITH/NETWORK/RPC_REQUEST');
    // Undocumented secret-carrying properties and raw causes are stripped
    expect(recordedErr).not.toHaveProperty('viewingKey');
    expect(recordedErr).not.toHaveProperty('headers');
    expect(recordedErr).not.toHaveProperty('cause');
    expect(JSON.stringify(recordedErr)).not.toContain('supersecretpass');
    expect(JSON.stringify(recordedErr)).not.toContain(SECRET_CORPUS.viewingKeyHex);
    expect(JSON.stringify(recordedErr)).not.toContain('abandon ability');

    // Direct createSafeTracer & startSafeSpan also enforce the safe shape and idempotent end()
    const safeTracer = createSafeTracer(tracer);
    const manualSpan = safeTracer.startSpan('manual.op', {
      spendingScalar: SECRET_CORPUS.spendingScalarDec,
    });
    manualSpan.setAttribute('metadata', SECRET_CORPUS.rawAnnouncementMetadata);
    manualSpan.end();
    manualSpan.end();

    expect(captured[1].initialAttributes).toEqual({ spendingScalar: REDACTED_VALUE });
    expect(captured[1].dynamicAttributes).toEqual({ metadata: REDACTED_VALUE });
    expect(captured[1].endedCount).toBe(1);

    const helperSpan = startSafeSpan('helper.op', { secretSeed: SECRET_CORPUS.stellarSecretSeed });
    helperSpan.end();
    expect(captured[2].initialAttributes).toEqual({ secretSeed: REDACTED_VALUE });
  });

  test('createRpcClient redacts endpoint credentials in telemetry spans and failover events', async () => {
    const { tracer, captured } = createCapturingTracer();
    const failovers: Array<{ from: string; to: string; reason: string }> = [];

    const client = createRpcClient({
      endpoints: [
        { url: 'https://user1:pass1@primary.rpc.test?api_key=keyOne' },
        { url: 'https://user2:pass2@backup.rpc.test?token=keyTwo' },
      ],
      circuitBreaker: { failureThreshold: 1, cooldownMs: 5000 },
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
      tracer,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes('primary.rpc.test')) {
          return new Response('unavailable', { status: 503 });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    client.on('endpointFailover', (detail) => failovers.push(detail));

    const res = await client.request<{ ok: boolean }>('POST', '/rpc?api_key=callSecret', {
      jsonrpc: '2.0',
    });
    expect(res).toEqual({ ok: true });

    const serializedSpans = JSON.stringify(captured);
    expect(serializedSpans).not.toContain('pass1');
    expect(serializedSpans).not.toContain('pass2');
    expect(serializedSpans).not.toContain('keyOne');
    expect(serializedSpans).not.toContain('keyTwo');
    expect(serializedSpans).not.toContain('callSecret');

    expect(failovers).toHaveLength(1);
    const serializedFailovers = JSON.stringify(failovers);
    expect(serializedFailovers).not.toContain('pass1');
    expect(serializedFailovers).not.toContain('pass2');
    expect(serializedFailovers).not.toContain('keyOne');
    expect(serializedFailovers).not.toContain('keyTwo');
  });

  test('scanAnnouncementsStream sanitizes exceptions and attributes on custom tracers', async () => {
    const { tracer, captured } = createCapturingTracer();
    const keys = deriveStealthKeys(new Uint8Array(64).fill(0x55));
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    async function* failingSource() {
      yield {
        schemeId: 1,
        stealthAddress: stealth.stealthAddress,
        caller: SAFE_OPERATIONAL_CONTEXT.stellarAddress,
        ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
        metadata: stealth.viewTag.toString(16).padStart(2, '0'),
      };
      throw new Error(`RPC stream dropped for ${SECRET_CORPUS.rpcUrlWithCreds}`);
    }

    const matches = [];
    await expect(async () => {
      for await (const m of scanAnnouncementsStream(
        failingSource(),
        keys.viewingKey,
        keys.spendingPubKey,
        keys.spendingScalar,
        { tracer },
      )) {
        matches.push(m);
      }
    }).rejects.toThrow();

    expect(matches).toHaveLength(1);
    const scanSpan = captured.find((s) => s.name === 'stellar.scan');
    expect(scanSpan).toBeDefined();
    expect(JSON.stringify(scanSpan)).not.toContain('supersecretpass');
    expect(JSON.stringify(scanSpan)).not.toContain('querySecret123');
    expect(JSON.stringify(scanSpan)).not.toContain(bytesToHex(keys.viewingKey));
  });

  test('sanitizeTelemetryAttributes, sanitizeTelemetryAttributeValue, and sanitizeTelemetryException cover edge types', () => {
    expect(sanitizeTelemetryAttributes(undefined)).toBeUndefined();
    expect(sanitizeTelemetryAttributeValue('rawBytes', new Uint8Array([1, 2, 3]))).toBe(
      REDACTED_VALUE,
    );
    expect(sanitizeTelemetryAttributeValue('count', Number.NaN)).toBe('NaN');
    const cleanErr = sanitizeTelemetryException('raw string token sk-live-secret99999999');
    expect(cleanErr).toBeInstanceOf(Error);
    expect(cleanErr.message).toBe(`raw string token ${REDACTED_VALUE}`);
  });
});

describe('KeyVault serialization and corrupt-entry hardening', () => {
  const originalIndexedDB = globalThis.indexedDB;
  const originalIDBKeyRange = globalThis.IDBKeyRange;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  afterEach(() => {
    globalThis.indexedDB = originalIndexedDB;
    globalThis.IDBKeyRange = originalIDBKeyRange;
    globalThis.window = originalWindow as any;
    globalThis.document = originalDocument as any;
  });

  test('KeyVault.toJSON() exposes only locked state and dbName, and corrupt entries throw a generic error', async () => {
    const noopTarget = {
      addEventListener() {},
      removeEventListener() {},
      visibilityState: 'visible',
    };
    globalThis.indexedDB = new IDBFactory();
    globalThis.IDBKeyRange = IDBKeyRange;
    globalThis.window = noopTarget as any;
    globalThis.document = noopTarget as any;

    const vault = new KeyVault({
      dbName: 'wraith-redaction-vault',
      iterations: 1000,
      idleTimeoutMs: null,
    });

    expect(JSON.parse(JSON.stringify(vault))).toEqual({
      locked: true,
      dbName: 'wraith-redaction-vault',
    });

    await vault.unlock('vault-passphrase-123');
    expect(JSON.parse(JSON.stringify(vault))).toEqual({
      locked: false,
      dbName: 'wraith-redaction-vault',
    });

    await vault.put('primary', { viewingKey: SECRET_CORPUS.viewingKeyHex });

    // Corrupt the stored ciphertext in IndexedDB and ensure get() throws a clean, secret-free error
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('wraith-redaction-vault');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('entries', 'readwrite');
      tx.objectStore('entries').put({
        key: 'primary',
        iv: 'AAAAAAAAAAAAAAAA',
        ciphertext: 'corrupted-ciphertext-not-valid-gcm',
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    await expect(vault.get('primary')).rejects.toThrow(
      'Unable to decrypt KeyVault entry. The vault entry may be corrupt.',
    );
    await vault.lock();
  });
});
