import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import {
  FederationResolutionError,
  clearFederationCache,
  getFederationDefaultTtl,
  resolveStellarFederation,
  setFederationDefaultTtl,
} from '../../../src/chains/stellar/federation';

type FetchInput = { url: string; init?: RequestInit };

function textResponse(body: string, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: '',
    text: async () => body,
  } as unknown as Response;
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return textResponse(JSON.stringify(body), init);
}

function mockFetch(handler: (call: FetchInput) => Response | Promise<Response>) {
  const calls: FetchInput[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const call = { url, init };
    calls.push(call);
    return handler(call);
  });
  return { impl, calls };
}

const tomlBody = (federationUrl: string) => `
NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"
FEDERATION_SERVER = "${federationUrl}"
WEB_AUTH_ENDPOINT  = "https://example.com/auth"
`;

describe('resolveStellarFederation', () => {
  const recipient = Keypair.random();
  const federationUrl = 'https://federation.example.com/federation';

  beforeEach(() => {
    clearFederationCache();
    setFederationDefaultTtl(60 * 60 * 1000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearFederationCache();
  });

  it('resolves a federation address through stellar.toml + federation server', async () => {
    const { impl, calls } = mockFetch(({ url }) => {
      if (url.endsWith('/.well-known/stellar.toml')) {
        return textResponse(tomlBody(federationUrl));
      }
      if (url.startsWith(federationUrl)) {
        return jsonResponse({
          stellar_address: 'alice*example.com',
          account_id: recipient.publicKey(),
          memo_type: 'text',
          memo: 'invoice-42',
        });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await resolveStellarFederation('alice*example.com', { fetchImpl: impl });

    expect(result.accountId).toBe(recipient.publicKey());
    expect(result.memo).toEqual({ type: 'text', value: 'invoice-42' });
    expect(result.stellarAddress).toBe('alice*example.com');
    expect(result.resolvedAt).toBeTypeOf('number');

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://example.com/.well-known/stellar.toml');
    expect(calls[1].url).toBe(
      `${federationUrl}?q=${encodeURIComponent('alice*example.com')}&type=name`,
    );
  });

  it('returns a result without memo when none is provided', async () => {
    const { impl } = mockFetch(({ url }) => {
      if (url.endsWith('/.well-known/stellar.toml')) return textResponse(tomlBody(federationUrl));
      return jsonResponse({
        stellar_address: 'bob*example.com',
        account_id: recipient.publicKey(),
      });
    });

    const result = await resolveStellarFederation('bob*example.com', { fetchImpl: impl });

    expect(result.accountId).toBe(recipient.publicKey());
    expect(result.memo).toBeUndefined();
  });

  it('caches resolutions for the configured TTL', async () => {
    const { impl, calls } = mockFetch(({ url }) => {
      if (url.endsWith('/.well-known/stellar.toml')) return textResponse(tomlBody(federationUrl));
      return jsonResponse({ account_id: recipient.publicKey() });
    });

    await resolveStellarFederation('carol*example.com', { fetchImpl: impl });
    await resolveStellarFederation('carol*example.com', { fetchImpl: impl });
    await resolveStellarFederation('carol*example.com', { fetchImpl: impl });

    expect(calls).toHaveLength(2);
  });

  it('skips the cache when noCache is set', async () => {
    const { impl, calls } = mockFetch(({ url }) => {
      if (url.endsWith('/.well-known/stellar.toml')) return textResponse(tomlBody(federationUrl));
      return jsonResponse({ account_id: recipient.publicKey() });
    });

    await resolveStellarFederation('dan*example.com', { fetchImpl: impl });
    await resolveStellarFederation('dan*example.com', { fetchImpl: impl, noCache: true });
    await resolveStellarFederation('dan*example.com', { fetchImpl: impl, noCache: true });

    expect(calls).toHaveLength(6);
  });

  it('does not cache when cacheTtlMs is 0', async () => {
    const { impl, calls } = mockFetch(({ url }) => {
      if (url.endsWith('/.well-known/stellar.toml')) return textResponse(tomlBody(federationUrl));
      return jsonResponse({ account_id: recipient.publicKey() });
    });

    await resolveStellarFederation('eve*example.com', { fetchImpl: impl, cacheTtlMs: 0 });
    await resolveStellarFederation('eve*example.com', { fetchImpl: impl, cacheTtlMs: 0 });

    expect(calls).toHaveLength(4);
  });

  it('refetches once an entry has expired', async () => {
    setFederationDefaultTtl(50);
    const { impl, calls } = mockFetch(({ url }) => {
      if (url.endsWith('/.well-known/stellar.toml')) return textResponse(tomlBody(federationUrl));
      return jsonResponse({ account_id: recipient.publicKey() });
    });

    await resolveStellarFederation('frank*example.com', { fetchImpl: impl });
    await new Promise((resolve) => setTimeout(resolve, 80));
    await resolveStellarFederation('frank*example.com', { fetchImpl: impl });

    expect(calls).toHaveLength(4);
  });

  it('passes through a valid G... account ID without hitting the network', async () => {
    const { impl, calls } = mockFetch(() => textResponse('should not be called', { ok: false }));

    const result = await resolveStellarFederation(recipient.publicKey(), { fetchImpl: impl });

    expect(result.accountId).toBe(recipient.publicKey());
    expect(result.stellarAddress).toBe(recipient.publicKey());
    expect(result.memo).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('rejects malformed federation addresses with INVALID_ADDRESS', async () => {
    await expect(
      resolveStellarFederation('not-a-federation-address', { fetchImpl: vi.fn() }),
    ).rejects.toMatchObject({
      name: 'FederationResolutionError',
      code: 'INVALID_ADDRESS',
    });

    await expect(
      resolveStellarFederation('alice@example.com', { fetchImpl: vi.fn() }),
    ).rejects.toMatchObject({ code: 'INVALID_ADDRESS' });

    await expect(
      resolveStellarFederation('alice*nodot', { fetchImpl: vi.fn() }),
    ).rejects.toMatchObject({ code: 'INVALID_ADDRESS' });

    await expect(resolveStellarFederation('', { fetchImpl: vi.fn() })).rejects.toMatchObject({
      code: 'INVALID_ADDRESS',
    });
  });

  it('throws TOML_FETCH_FAILED on stellar.toml HTTP errors', async () => {
    const { impl } = mockFetch(() => textResponse('not found', { ok: false, status: 404 }));

    await expect(
      resolveStellarFederation('gina*example.com', { fetchImpl: impl }),
    ).rejects.toMatchObject({ code: 'TOML_FETCH_FAILED' });
  });

  it('throws FEDERATION_SERVER_MISSING when stellar.toml has no FEDERATION_SERVER', async () => {
    const { impl } = mockFetch(({ url }) => {
      if (url.endsWith('/.well-known/stellar.toml')) {
        return textResponse('NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"');
      }
      throw new Error('unreachable');
    });

    await expect(
      resolveStellarFederation('harry*example.com', { fetchImpl: impl }),
    ).rejects.toMatchObject({ code: 'FEDERATION_SERVER_MISSING' });
  });

  it('rejects http:// federation servers unless allowInsecureHttp is set', async () => {
    const tomlInsecure = tomlBody('http://insecure.example.com/federation');
    const { impl } = mockFetch(({ url }) => {
      if (url.endsWith('/.well-known/stellar.toml')) return textResponse(tomlInsecure);
      return jsonResponse({ account_id: recipient.publicKey() });
    });

    await expect(
      resolveStellarFederation('isaac*example.com', { fetchImpl: impl }),
    ).rejects.toMatchObject({ code: 'INSECURE_PROTOCOL' });

    clearFederationCache();
    const allowed = await resolveStellarFederation('isaac*example.com', {
      fetchImpl: impl,
      allowInsecureHttp: true,
    });
    expect(allowed.accountId).toBe(recipient.publicKey());
  });

  it('throws FEDERATION_SERVER_FAILED on federation server HTTP errors', async () => {
    const { impl } = mockFetch(({ url }) => {
      if (url.endsWith('/.well-known/stellar.toml')) return textResponse(tomlBody(federationUrl));
      return textResponse('forbidden', { ok: false, status: 403 });
    });

    await expect(
      resolveStellarFederation('jess*example.com', { fetchImpl: impl }),
    ).rejects.toMatchObject({ code: 'FEDERATION_SERVER_FAILED' });
  });

  it('throws INVALID_RESPONSE when account_id is missing', async () => {
    const { impl } = mockFetch(({ url }) => {
      if (url.endsWith('/.well-known/stellar.toml')) return textResponse(tomlBody(federationUrl));
      return jsonResponse({ stellar_address: 'kev*example.com' });
    });

    await expect(
      resolveStellarFederation('kev*example.com', { fetchImpl: impl }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('throws INVALID_RESPONSE when account_id is not a Stellar StrKey', async () => {
    const { impl } = mockFetch(({ url }) => {
      if (url.endsWith('/.well-known/stellar.toml')) return textResponse(tomlBody(federationUrl));
      return jsonResponse({ account_id: 'not-a-strkey' });
    });

    await expect(
      resolveStellarFederation('luke*example.com', { fetchImpl: impl }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('surfaces federation server error bodies via INVALID_RESPONSE', async () => {
    const { impl } = mockFetch(({ url }) => {
      if (url.endsWith('/.well-known/stellar.toml')) return textResponse(tomlBody(federationUrl));
      return jsonResponse({ detail: 'unknown user' });
    });

    await expect(
      resolveStellarFederation('mia*example.com', { fetchImpl: impl }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: expect.stringMatching(/unknown user/),
    });
  });

  it('throws INVALID_RESPONSE on an unsupported memo_type', async () => {
    const { impl } = mockFetch(({ url }) => {
      if (url.endsWith('/.well-known/stellar.toml')) return textResponse(tomlBody(federationUrl));
      return jsonResponse({
        account_id: recipient.publicKey(),
        memo_type: 'return',
        memo: '12345',
      });
    });

    await expect(
      resolveStellarFederation('nora*example.com', { fetchImpl: impl }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('honors the per-request timeout', async () => {
    const impl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return await new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    await expect(
      resolveStellarFederation('owen*example.com', { fetchImpl: impl, timeoutMs: 15 }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('exposes setFederationDefaultTtl / getFederationDefaultTtl', () => {
    setFederationDefaultTtl(123);
    expect(getFederationDefaultTtl()).toBe(123);
    expect(() => setFederationDefaultTtl(-1)).toThrow();
    expect(() => setFederationDefaultTtl(Number.NaN)).toThrow();
  });

  it('FederationResolutionError exposes code + cause', () => {
    const inner = new Error('boom');
    const err = new FederationResolutionError('TIMEOUT', 'fetch timed out', inner);
    expect(err.name).toBe('FederationResolutionError');
    expect(err.code).toBe('TIMEOUT');
    expect((err as { cause?: unknown }).cause).toBe(inner);
  });
});

// ---------------------------------------------------------------------------
// Opt-in integration test against a real federation server.
// Set FEDERATION_INTEGRATION=1 and FEDERATION_ADDRESS=<name*domain.tld> to run.
// ---------------------------------------------------------------------------

const SKIP_INTEGRATION = process.env['FEDERATION_INTEGRATION'] !== '1';

describe('resolveStellarFederation integration', { skip: SKIP_INTEGRATION }, () => {
  it('resolves a configured live federation address', async () => {
    const address = process.env['FEDERATION_ADDRESS'];
    if (!address) throw new Error('FEDERATION_ADDRESS is required when FEDERATION_INTEGRATION=1');

    clearFederationCache();
    const result = await resolveStellarFederation(address, { timeoutMs: 15_000 });

    expect(result.accountId).toMatch(/^G[A-Z0-9]{55}$/);
    expect(result.stellarAddress).toBeTypeOf('string');
    if (result.memo) {
      expect(['text', 'id', 'hash']).toContain(result.memo.type);
    }

    const expectedAccount = process.env['FEDERATION_EXPECTED_ACCOUNT'];
    if (expectedAccount) {
      expect(result.accountId).toBe(expectedAccount);
    }
  }, 30_000);
});
