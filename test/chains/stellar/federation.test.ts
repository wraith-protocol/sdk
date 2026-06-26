import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FederationResolver,
  FederationError,
  resolveStellarFederation,
} from '../../../src/chains/stellar/federation';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToml(federationUrl = 'https://federation.example.com'): string {
  return `NETWORK_PASSPHRASE="Test SDF Network ; September 2015"\nFEDERATION_SERVER="${federationUrl}"\n`;
}

function makeFedResponse(accountId: string, extra: Record<string, string> = {}): string {
  return JSON.stringify({ stellar_address: 'alice*example.com', account_id: accountId, ...extra });
}

type MockEntry = { status: number; body: string };

function mockFetch(responses: Record<string, MockEntry>) {
  return vi.fn(async (url: string) => {
    const entry = responses[url];
    if (!entry) throw new Error(`Unexpected fetch call: ${url}`);
    return {
      ok: entry.status >= 200 && entry.status < 300,
      status: entry.status,
      text: async () => entry.body,
    } as Response;
  });
}

const FAKE_ACCOUNT = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSHV1NFOU3FAKE';

// Default responses for happy-path tests
function defaultResponses(): Record<string, MockEntry> {
  return {
    'https://example.com/.well-known/stellar.toml': {
      status: 200,
      body: makeToml('https://federation.example.com'),
    },
    'https://federation.example.com?q=alice%2Aexample.com&type=name': {
      status: 200,
      body: makeFedResponse(FAKE_ACCOUNT),
    },
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('FederationResolver — happy path', () => {
  let fetchFn: ReturnType<typeof mockFetch>;
  let resolver: FederationResolver;

  beforeEach(() => {
    fetchFn = mockFetch(defaultResponses());
    resolver = new FederationResolver({ fetch: fetchFn as never, cacheTtl: 60_000 });
  });

  it('resolves a valid federation address', async () => {
    const result = await resolver.resolve('alice*example.com');
    expect(result.accountId).toBe(FAKE_ACCOUNT);
    expect(result.memo).toBeUndefined();
  });

  it('fetches stellar.toml first, then queries the federation server', async () => {
    await resolver.resolve('alice*example.com');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn).toHaveBeenNthCalledWith(1, 'https://example.com/.well-known/stellar.toml');
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      'https://federation.example.com?q=alice%2Aexample.com&type=name',
    );
  });

  it('encodes the federation address in the query string', async () => {
    // `*` must be percent-encoded as %2A in the q= parameter
    await resolver.resolve('alice*example.com');
    const calledUrl = fetchFn.mock.calls[1][0] as string;
    expect(calledUrl).toContain('q=alice%2Aexample.com');
  });

  it('caches the result — only two HTTP calls for repeated resolves', async () => {
    await resolver.resolve('alice*example.com');
    await resolver.resolve('alice*example.com');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('re-fetches after invalidate()', async () => {
    await resolver.resolve('alice*example.com');
    resolver.invalidate('alice*example.com');
    await resolver.resolve('alice*example.com');
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('re-fetches after clear()', async () => {
    await resolver.resolve('alice*example.com');
    resolver.clear();
    await resolver.resolve('alice*example.com');
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('normalises address to lowercase for cache keying', async () => {
    await resolver.resolve('Alice*Example.com');
    await resolver.resolve('ALICE*EXAMPLE.COM');
    // Both resolve to the same cache key — only 2 real HTTP calls total
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('skips the cache when cacheTtl=0', async () => {
    const f = mockFetch(defaultResponses());
    const r = new FederationResolver({ fetch: f as never, cacheTtl: 0 });
    await r.resolve('alice*example.com');
    await r.resolve('alice*example.com');
    expect(f).toHaveBeenCalledTimes(4); // 2 HTTP calls × 2 resolves
  });
});

// ---------------------------------------------------------------------------
// Memo handling
// ---------------------------------------------------------------------------

describe('FederationResolver — memo handling', () => {
  it.each([
    ['text', 'payment-ref-123'],
    ['id', '99887766'],
    ['hash', 'deadbeefcafe'],
  ] as const)('parses memo_type=%s', async (memoType, memoValue) => {
    const f = mockFetch({
      'https://example.com/.well-known/stellar.toml': {
        status: 200,
        body: makeToml(),
      },
      'https://federation.example.com?q=alice%2Aexample.com&type=name': {
        status: 200,
        body: makeFedResponse(FAKE_ACCOUNT, { memo_type: memoType, memo: memoValue }),
      },
    });
    const r = new FederationResolver({ fetch: f as never });
    const result = await r.resolve('alice*example.com');
    expect(result.memo).toEqual({ type: memoType, value: memoValue });
  });

  it('omits memo when only memo_type is present (no memo value)', async () => {
    const f = mockFetch({
      'https://example.com/.well-known/stellar.toml': { status: 200, body: makeToml() },
      'https://federation.example.com?q=alice%2Aexample.com&type=name': {
        status: 200,
        body: JSON.stringify({ account_id: FAKE_ACCOUNT, memo_type: 'text' }),
      },
    });
    const r = new FederationResolver({ fetch: f as never });
    const result = await r.resolve('alice*example.com');
    expect(result.memo).toBeUndefined();
  });

  it('omits memo when only memo is present (no memo_type)', async () => {
    const f = mockFetch({
      'https://example.com/.well-known/stellar.toml': { status: 200, body: makeToml() },
      'https://federation.example.com?q=alice%2Aexample.com&type=name': {
        status: 200,
        body: JSON.stringify({ account_id: FAKE_ACCOUNT, memo: 'orphan-memo' }),
      },
    });
    const r = new FederationResolver({ fetch: f as never });
    const result = await r.resolve('alice*example.com');
    expect(result.memo).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// TOML parsing edge cases
// ---------------------------------------------------------------------------

describe('FederationResolver — TOML parsing', () => {
  function makeResolver(tomlBody: string) {
    const f = mockFetch({
      'https://example.com/.well-known/stellar.toml': { status: 200, body: tomlBody },
      'https://federation.example.com?q=alice%2Aexample.com&type=name': {
        status: 200,
        body: makeFedResponse(FAKE_ACCOUNT),
      },
    });
    return new FederationResolver({ fetch: f as never });
  }

  it('accepts single-quoted FEDERATION_SERVER', async () => {
    const r = makeResolver(`FEDERATION_SERVER='https://federation.example.com'\n`);
    const result = await r.resolve('alice*example.com');
    expect(result.accountId).toBe(FAKE_ACCOUNT);
  });

  it('ignores other TOML keys before FEDERATION_SERVER', async () => {
    const toml = [
      `NETWORK_PASSPHRASE="Test"`,
      `ACCOUNTS=["GABC"]`,
      `FEDERATION_SERVER="https://federation.example.com"`,
      `HORIZON_URL="https://horizon.example.com"`,
    ].join('\n');
    const r = makeResolver(toml);
    const result = await r.resolve('alice*example.com');
    expect(result.accountId).toBe(FAKE_ACCOUNT);
  });

  it('handles FEDERATION_SERVER with leading whitespace', async () => {
    const r = makeResolver(`  FEDERATION_SERVER = "https://federation.example.com"\n`);
    const result = await r.resolve('alice*example.com');
    expect(result.accountId).toBe(FAKE_ACCOUNT);
  });

  it('appends &q= when federation URL already contains a query string', async () => {
    const f = mockFetch({
      'https://example.com/.well-known/stellar.toml': {
        status: 200,
        body: `FEDERATION_SERVER="https://federation.example.com/api?version=2"\n`,
      },
      'https://federation.example.com/api?version=2&q=alice%2Aexample.com&type=name': {
        status: 200,
        body: makeFedResponse(FAKE_ACCOUNT),
      },
    });
    const r = new FederationResolver({ fetch: f as never });
    const result = await r.resolve('alice*example.com');
    expect(result.accountId).toBe(FAKE_ACCOUNT);
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('FederationResolver — errors', () => {
  it('throws INVALID_ADDRESS when * is absent', async () => {
    const r = new FederationResolver({ fetch: vi.fn() as never });
    await expect(r.resolve('aliceexample.com')).rejects.toMatchObject({
      code: 'INVALID_ADDRESS',
    });
  });

  it('throws INVALID_ADDRESS for multiple * separators', async () => {
    const r = new FederationResolver({ fetch: vi.fn() as never });
    await expect(r.resolve('alice*foo*example.com')).rejects.toMatchObject({
      code: 'INVALID_ADDRESS',
    });
  });

  it('throws INVALID_ADDRESS when domain has no dot', async () => {
    const r = new FederationResolver({ fetch: vi.fn() as never });
    await expect(r.resolve('alice*examplecom')).rejects.toMatchObject({
      code: 'INVALID_ADDRESS',
    });
  });

  it('throws INVALID_ADDRESS for whitespace in name', async () => {
    const r = new FederationResolver({ fetch: vi.fn() as never });
    await expect(r.resolve('ali ce*example.com')).rejects.toMatchObject({
      code: 'INVALID_ADDRESS',
    });
  });

  it('throws TOML_FETCH_FAILED when stellar.toml returns non-2xx', async () => {
    const f = mockFetch({
      'https://example.com/.well-known/stellar.toml': { status: 500, body: '' },
    });
    const r = new FederationResolver({ fetch: f as never });
    await expect(r.resolve('alice*example.com')).rejects.toMatchObject({
      code: 'TOML_FETCH_FAILED',
    });
  });

  it('throws TOML_FETCH_FAILED when fetch rejects with a network error', async () => {
    const f = vi.fn().mockRejectedValue(new Error('network unreachable'));
    const r = new FederationResolver({ fetch: f as never });
    await expect(r.resolve('alice*example.com')).rejects.toMatchObject({
      code: 'TOML_FETCH_FAILED',
      message: expect.stringContaining('network unreachable'),
    });
  });

  it('throws NO_FEDERATION_SERVER when stellar.toml lacks FEDERATION_SERVER', async () => {
    const f = mockFetch({
      'https://example.com/.well-known/stellar.toml': {
        status: 200,
        body: 'NETWORK_PASSPHRASE="Test"\n',
      },
    });
    const r = new FederationResolver({ fetch: f as never });
    await expect(r.resolve('alice*example.com')).rejects.toMatchObject({
      code: 'NO_FEDERATION_SERVER',
    });
  });

  it('throws TOML_PARSE_FAILED when FEDERATION_SERVER uses HTTP', async () => {
    const f = mockFetch({
      'https://example.com/.well-known/stellar.toml': {
        status: 200,
        body: `FEDERATION_SERVER="http://federation.example.com"\n`,
      },
    });
    const r = new FederationResolver({ fetch: f as never });
    await expect(r.resolve('alice*example.com')).rejects.toMatchObject({
      code: 'TOML_PARSE_FAILED',
    });
  });

  it('throws TOML_PARSE_FAILED when FEDERATION_SERVER is not a valid URL', async () => {
    const f = mockFetch({
      'https://example.com/.well-known/stellar.toml': {
        status: 200,
        body: `FEDERATION_SERVER="not-a-url"\n`,
      },
    });
    const r = new FederationResolver({ fetch: f as never });
    await expect(r.resolve('alice*example.com')).rejects.toMatchObject({
      code: 'TOML_PARSE_FAILED',
    });
  });

  it('throws NOT_FOUND when federation server returns 404', async () => {
    const f = mockFetch({
      'https://example.com/.well-known/stellar.toml': { status: 200, body: makeToml() },
      'https://federation.example.com?q=alice%2Aexample.com&type=name': { status: 404, body: '' },
    });
    const r = new FederationResolver({ fetch: f as never });
    await expect(r.resolve('alice*example.com')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws FEDERATION_FETCH_FAILED on a non-404 server error', async () => {
    const f = mockFetch({
      'https://example.com/.well-known/stellar.toml': { status: 200, body: makeToml() },
      'https://federation.example.com?q=alice%2Aexample.com&type=name': { status: 503, body: '' },
    });
    const r = new FederationResolver({ fetch: f as never });
    await expect(r.resolve('alice*example.com')).rejects.toMatchObject({
      code: 'FEDERATION_FETCH_FAILED',
    });
  });

  it('surfaces the error detail field from a JSON error body', async () => {
    const f = mockFetch({
      'https://example.com/.well-known/stellar.toml': { status: 200, body: makeToml() },
      'https://federation.example.com?q=alice%2Aexample.com&type=name': {
        status: 400,
        body: JSON.stringify({ detail: 'rate limit exceeded' }),
      },
    });
    const r = new FederationResolver({ fetch: f as never });
    const err = (await r.resolve('alice*example.com').catch((e) => e)) as FederationError;
    expect(err.message).toContain('rate limit exceeded');
  });

  it('throws INVALID_RESPONSE when account_id is missing from federation response', async () => {
    const f = mockFetch({
      'https://example.com/.well-known/stellar.toml': { status: 200, body: makeToml() },
      'https://federation.example.com?q=alice%2Aexample.com&type=name': {
        status: 200,
        body: JSON.stringify({ stellar_address: 'alice*example.com' }),
      },
    });
    const r = new FederationResolver({ fetch: f as never });
    await expect(r.resolve('alice*example.com')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('throws INVALID_RESPONSE for an unknown memo_type', async () => {
    const f = mockFetch({
      'https://example.com/.well-known/stellar.toml': { status: 200, body: makeToml() },
      'https://federation.example.com?q=alice%2Aexample.com&type=name': {
        status: 200,
        body: JSON.stringify({ account_id: FAKE_ACCOUNT, memo_type: 'binary', memo: '0xff' }),
      },
    });
    const r = new FederationResolver({ fetch: f as never });
    await expect(r.resolve('alice*example.com')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('throws INVALID_RESPONSE when the federation server returns non-JSON', async () => {
    const f = mockFetch({
      'https://example.com/.well-known/stellar.toml': { status: 200, body: makeToml() },
      'https://federation.example.com?q=alice%2Aexample.com&type=name': {
        status: 200,
        body: '<html>error</html>',
      },
    });
    const r = new FederationResolver({ fetch: f as never });
    await expect(r.resolve('alice*example.com')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('FederationError has the correct name property', async () => {
    const r = new FederationResolver({ fetch: vi.fn() as never });
    const err = (await r.resolve('bad').catch((e) => e)) as FederationError;
    expect(err).toBeInstanceOf(FederationError);
    expect(err.name).toBe('FederationError');
  });

  it('throws FEDERATION_FETCH_FAILED when the fetch call to the federation server rejects', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => makeToml(),
      } as Response)
      .mockRejectedValueOnce(new Error('connection refused'));
    const r = new FederationResolver({ fetch: f as never });
    await expect(r.resolve('alice*example.com')).rejects.toMatchObject({
      code: 'FEDERATION_FETCH_FAILED',
      message: expect.stringContaining('connection refused'),
    });
  });
});

// ---------------------------------------------------------------------------
// Module-level export
// ---------------------------------------------------------------------------

describe('resolveStellarFederation', () => {
  it('is exported and is a function', () => {
    expect(typeof resolveStellarFederation).toBe('function');
  });

  it('rejects invalid addresses with INVALID_ADDRESS', async () => {
    await expect(resolveStellarFederation('notafedaddress')).rejects.toMatchObject({
      code: 'INVALID_ADDRESS',
    });
  });
});
