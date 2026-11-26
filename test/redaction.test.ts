import { describe, expect, test } from 'vitest';
import { RPCRequestError } from '../src/errors';
import { REDACTED, redact } from '../src/redaction';
import { setTracer, withSpan, type Span, type Tracer } from '../src/telemetry';

describe('central secret redaction policy', () => {
  test('redacts the secret corpus deterministically while preserving safe context', () => {
    const corpus = {
      viewingKey: 'viewing-key-secret',
      seed: 'seed-secret',
      signature: 'deadbeef-signature',
      authorization: 'Bearer bearer-secret',
      endpoint: 'https://rpc-user:rpc-password@example.test/?api_key=rpc-secret&network=testnet',
      encryptedEnvelope: {
        salt: 'salt-secret',
        iv: 'iv-secret',
        ciphertext: 'ciphertext-secret',
        authTag: 'tag-secret',
      },
      decryptedMetadata: 'private memo',
      code: 'WRAITH/NETWORK/RPC_REQUEST',
      statusCode: 503,
      txHash: 'public-transaction-hash',
    };

    const first = redact(corpus);
    expect(first).toEqual(redact(corpus));
    expect(JSON.stringify(first)).not.toContain('secret');
    expect(JSON.stringify(first)).not.toContain('password');
    expect((first as typeof corpus).viewingKey).toBe(REDACTED);
    expect((first as typeof corpus).code).toBe(corpus.code);
    expect((first as typeof corpus).statusCode).toBe(503);
    expect((first as typeof corpus).txHash).toBe(corpus.txHash);
  });

  test('serializes structured errors without leaking context', () => {
    const error = new RPCRequestError(
      'https://user:password@example.test/?access_token=secret',
      401,
      'Bearer response-secret',
    );
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('response-secret');
    expect(serialized).toContain('401');
    expect(error.toJSON().code).toBe('WRAITH/NETWORK/RPC_REQUEST');
  });

  test('user telemetry hooks receive only safe attributes and exceptions', () => {
    const seen: { attributes?: Record<string, unknown>; exception?: unknown } = {};
    const span: Span = {
      setAttribute: () => undefined,
      recordException: (error) => {
        seen.exception = error;
      },
      end: () => undefined,
    };
    const tracer: Tracer = {
      startSpan: (_name, attributes) => {
        seen.attributes = attributes;
        return span;
      },
    };
    setTracer(tracer);
    try {
      expect(() =>
        withSpan('rpc', { apiKey: 'secret', status: 500 }, () => {
          throw new Error('Bearer secret');
        }),
      ).toThrow();
      expect(JSON.stringify(seen)).not.toContain('secret');
      expect(seen.attributes?.status).toBe(500);
    } finally {
      setTracer(undefined);
    }
  });
});
