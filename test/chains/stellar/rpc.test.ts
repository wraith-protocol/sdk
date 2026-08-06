import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRpcClient, type RpcClientConfig } from '../../../src/chains/stellar/rpc';
import { RPCRetryExhaustedError, RPCRequestError } from '../../../src/errors';

function mockFetch(
  responses: Map<string, { status: number; body: unknown; delay?: number }>,
): typeof fetch {
  return vi.fn(async (url: string) => {
    const match = responses.get(url);
    if (!match) {
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    }
    if (match.delay) {
      await new Promise((r) => setTimeout(r, match.delay));
    }
    return new Response(JSON.stringify(match.body), { status: match.status });
  });
}

function mockFetchSequence(
  url: string,
  sequence: Array<{ status: number; body: unknown }>,
): typeof fetch {
  let callCount = 0;
  const normalize = (s: string) => s.replace(/\/$/, '');
  return vi.fn(async (u: string) => {
    if (normalize(u) !== normalize(url)) {
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    }
    const idx = Math.min(callCount, sequence.length - 1);
    const resp = sequence[idx];
    callCount++;
    return new Response(JSON.stringify(resp.body), { status: resp.status });
  });
}

describe('createRpcClient', () => {
  const primaryUrl = 'https://rpc-primary.test';
  const fallbackUrl = 'https://rpc-fallback.test';

  let responses: Map<string, { status: number; body: unknown }>;

  beforeEach(() => {
    responses = new Map();
  });

  it('throws if no endpoints provided', () => {
    expect(() => createRpcClient({ endpoints: [] })).toThrow(
      'At least one RPC endpoint is required',
    );
  });

  it('returns healthy endpoint', async () => {
    responses.set(`${primaryUrl}/`, { status: 200, body: { ok: true } });
    const fetchImpl = mockFetch(responses);

    const client = createRpcClient({
      endpoints: [{ url: primaryUrl }],
      fetchImpl,
    });

    const result = await client.request('GET', '/');
    expect(result).toEqual({ ok: true });
    expect(client.getHealthyEndpoint()).toBe(primaryUrl);
  });

  it('fails over to secondary endpoint on consecutive failures', async () => {
    const fetchImpl = mockFetchSequence(primaryUrl, [
      { status: 503, body: { error: 'down' } },
      { status: 503, body: { error: 'down' } },
      { status: 503, body: { error: 'down' } },
    ]);

    responses.set(`${fallbackUrl}/`, { status: 200, body: { ok: true, fallback: true } });
    const fetchImplFallback = mockFetch(responses);

    const actualFetch = vi.fn((url: string) => {
      if (url.startsWith(fallbackUrl)) return fetchImplFallback(url);
      return fetchImpl(url);
    });

    const failoverSpy = vi.fn();

    const client = createRpcClient({
      endpoints: [{ url: primaryUrl }, { url: fallbackUrl }],
      circuitBreaker: { failureThreshold: 3, cooldownMs: 30_000 },
      retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 10 },
      fetchImpl: actualFetch,
    });

    client.on('endpointFailover', failoverSpy);

    const result = await client.request('GET', '/');
    expect(result).toEqual({ ok: true, fallback: true });
    expect(client.getHealthyEndpoint()).toBe(fallbackUrl);
    expect(failoverSpy).toHaveBeenCalledWith(
      expect.objectContaining({ from: primaryUrl, to: fallbackUrl }),
    );
  });

  it('does not failover on a single transient error', async () => {
    const fetchImpl = mockFetchSequence(primaryUrl, [
      { status: 503, body: { error: 'overloaded' } },
      { status: 200, body: { ok: true } },
    ]);

    const failoverSpy = vi.fn();

    const client = createRpcClient({
      endpoints: [{ url: primaryUrl }, { url: fallbackUrl }],
      circuitBreaker: { failureThreshold: 3, cooldownMs: 30_000 },
      retry: { maxRetries: 1, baseDelayMs: 10, maxDelayMs: 10 },
      fetchImpl,
    });

    client.on('endpointFailover', failoverSpy);

    const result = await client.request('GET', '/');
    expect(result).toEqual({ ok: true });
    expect(failoverSpy).not.toHaveBeenCalled();
  });

  it('throws RPCRetryExhaustedError when all endpoints are down', async () => {
    const fetchPrimary = mockFetchSequence(primaryUrl, [
      { status: 503, body: { error: 'down' } },
      { status: 503, body: { error: 'down' } },
      { status: 503, body: { error: 'down' } },
    ]);
    const fetchFallback = mockFetchSequence(fallbackUrl, [
      { status: 503, body: { error: 'down' } },
      { status: 503, body: { error: 'down' } },
      { status: 503, body: { error: 'down' } },
    ]);

    const actualFetch = vi.fn((url: string) => {
      if (url.startsWith(fallbackUrl)) return fetchFallback(url);
      return fetchPrimary(url);
    });

    const client = createRpcClient({
      endpoints: [{ url: primaryUrl }, { url: fallbackUrl }],
      circuitBreaker: { failureThreshold: 3, cooldownMs: 30_000 },
      retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 10 },
      fetchImpl: actualFetch,
    });

    await expect(client.request('GET', '/')).rejects.toThrow(RPCRetryExhaustedError);
  });

  it('recovers endpoint after cooldown', async () => {
    const fetchSequence = vi.fn();
    fetchSequence
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'down' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'down' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'down' }), { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, recovered: true }), { status: 200 }),
      );

    const fetchFallback = mockFetchSequence(fallbackUrl, [
      { status: 200, body: { ok: true, fallback: true } },
    ]);

    const actualFetch = vi.fn((url: string) => {
      if (url.startsWith(fallbackUrl)) return fetchFallback(url);
      return fetchSequence();
    });

    const client = createRpcClient({
      endpoints: [{ url: primaryUrl }, { url: fallbackUrl }],
      circuitBreaker: { failureThreshold: 3, cooldownMs: 50 },
      retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 10 },
      fetchImpl: actualFetch,
    });

    await client.request('GET', '/');
    expect(client.getHealthyEndpoint()).toBe(fallbackUrl);

    await new Promise((r) => setTimeout(r, 100));

    fetchSequence.mockReset();
    fetchSequence.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, recovered: true }), { status: 200 }),
    );

    const result = await client.request('GET', '/');
    expect(result).toEqual({ ok: true, fallback: true });
  });

  it('rejects non-retryable HTTP statuses immediately', async () => {
    responses.set(`${primaryUrl}/`, { status: 400, body: { error: 'bad request' } });
    const fetchImpl = mockFetch(responses);

    const client = createRpcClient({
      endpoints: [{ url: primaryUrl }],
      fetchImpl,
    });

    await expect(client.request('GET', '/')).rejects.toThrow(RPCRequestError);
  });

  it('emits endpointFailover event', async () => {
    const fetchPrimary = mockFetchSequence(primaryUrl, [
      { status: 503, body: { error: 'down' } },
      { status: 503, body: { error: 'down' } },
      { status: 503, body: { error: 'down' } },
    ]);
    responses.set(`${fallbackUrl}/`, { status: 200, body: { ok: true } });
    const fetchFallback = mockFetch(responses);

    const actualFetch = vi.fn((url: string) => {
      if (url.startsWith(fallbackUrl)) return fetchFallback(url);
      return fetchPrimary(url);
    });

    const failoverSpy = vi.fn();
    const client = createRpcClient({
      endpoints: [{ url: primaryUrl }, { url: fallbackUrl }],
      circuitBreaker: { failureThreshold: 3, cooldownMs: 30_000 },
      retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 10 },
      fetchImpl: actualFetch,
    });

    client.on('endpointFailover', failoverSpy);
    await client.request('GET', '/');
    expect(failoverSpy).toHaveBeenCalledTimes(1);
    expect(failoverSpy).toHaveBeenCalledWith(
      expect.objectContaining({ from: primaryUrl, to: fallbackUrl, reason: expect.any(String) }),
    );
  });

  it('off removes event listener', async () => {
    const fetchPrimary = mockFetchSequence(primaryUrl, [
      { status: 503, body: { error: 'down' } },
      { status: 503, body: { error: 'down' } },
      { status: 503, body: { error: 'down' } },
    ]);
    responses.set(`${fallbackUrl}/`, { status: 200, body: { ok: true } });
    const fetchFallback = mockFetch(responses);

    const actualFetch = vi.fn((url: string) => {
      if (url.startsWith(fallbackUrl)) return fetchFallback(url);
      return fetchPrimary(url);
    });

    const failoverSpy = vi.fn();
    const client = createRpcClient({
      endpoints: [{ url: primaryUrl }, { url: fallbackUrl }],
      circuitBreaker: { failureThreshold: 3, cooldownMs: 30_000 },
      retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 10 },
      fetchImpl: actualFetch,
    });

    client.on('endpointFailover', failoverSpy);
    client.off('endpointFailover', failoverSpy);
    await client.request('GET', '/');
    expect(failoverSpy).not.toHaveBeenCalled();
  });

  it('works with a single endpoint', async () => {
    responses.set(`${primaryUrl}/test`, { status: 200, body: { data: 'ok' } });
    const fetchImpl = mockFetch(responses);

    const client = createRpcClient({
      endpoints: [{ url: primaryUrl }],
      fetchImpl,
    });

    const result = await client.request('GET', '/test');
    expect(result).toEqual({ data: 'ok' });
  });

  it('passes JSON body on POST', async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(init.body).toBe(JSON.stringify({ test: true }));
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    });

    const client = createRpcClient({
      endpoints: [{ url: primaryUrl }],
      fetchImpl,
    });

    const result = await client.request('POST', '/rpc', { test: true });
    expect(result).toEqual({ received: true });
  });
});
