import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHorizonClient } from '../../../src/chains/stellar/horizon';
import { createRpcClient } from '../../../src/chains/stellar/rpc';
import { AttemptDeadline, resolveTimeouts } from '../../../src/chains/stellar/timeouts';
import { RPCRetryExhaustedError, RPCTimeoutError } from '../../../src/errors';

const PRIMARY = 'https://rpc-primary.test';
const FALLBACK = 'https://rpc-fallback.test';
const HORIZON = 'https://horizon-testnet.stellar.org';

/** How one scripted fetch call behaves, given the signal the client passed in. */
type Behaviour = (signal: AbortSignal | undefined) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

/** Never answers, but rejects when aborted, like a real fetch to a black-holed host. */
const hang: Behaviour = (signal) =>
  new Promise((_, reject) => signal?.addEventListener('abort', () => reject(abortError())));

/** Never settles and ignores the abort signal, like a broken fetch polyfill. */
const ignoresAbort: Behaviour = () => new Promise(() => undefined);

const ok =
  (body: unknown): Behaviour =>
  async () =>
    jsonResponse(body);

const status =
  (code: number): Behaviour =>
  async () =>
    jsonResponse({ error: code }, code);

/** Answers after `ms`, or rejects if aborted first. */
const answersAfter =
  (ms: number, body: unknown): Behaviour =>
  (signal) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(jsonResponse(body)), ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(abortError());
      });
    });

/** Sends 200 headers and part of the body, then stalls until aborted. */
const stallsMidBody: Behaviour = async (signal) => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"result":'));
      signal?.addEventListener('abort', () => controller.error(signal.reason));
    },
  });
  return new Response(stream, { status: 200 });
};

interface FetchCall {
  url: string;
  signal: AbortSignal | undefined;
  /** Whether each earlier call's signal was already aborted when this call was made. */
  earlierAborted: boolean[];
}

/** A fetch scripted per URL prefix; the last behaviour of a route repeats. */
function scriptedFetch(routes: Record<string, Behaviour[]>) {
  const calls: FetchCall[] = [];
  const counts = new Map<string, number>();
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const signal = init?.signal ?? undefined;
    calls.push({ url, signal, earlierAborted: calls.map((c) => c.signal?.aborted ?? false) });
    const prefix = Object.keys(routes).find((p) => url.startsWith(p));
    if (!prefix) throw new Error(`unexpected fetch to ${url}`);
    const n = counts.get(prefix) ?? 0;
    counts.set(prefix, n + 1);
    const steps = routes[prefix];
    return steps[Math.min(n, steps.length - 1)](signal);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

/** Records how a promise settled without letting a rejection go unhandled. */
function track<T>(promise: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  promise.then(
    (value) => Object.assign(state, { settled: true, value }),
    (error) => Object.assign(state, { settled: true, error }),
  );
  return state;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('resolveTimeouts', () => {
  it('defaults to 10 s for the headers and 30 s in total', () => {
    expect(resolveTimeouts()).toEqual({ connectMs: 10_000, requestMs: 30_000 });
  });

  it('lets later layers override earlier ones, and 0 turns a timeout off', () => {
    expect(resolveTimeouts({ connectMs: 2_000 }, undefined, { requestMs: 0 })).toEqual({
      connectMs: 2_000,
      requestMs: 0,
    });
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31, '1000'])(
    'rejects %s as a timeout',
    (value) => {
      expect(() => resolveTimeouts({ connectMs: value as number })).toThrow(RangeError);
      expect(() =>
        createHorizonClient({ horizonUrl: HORIZON, timeouts: { requestMs: value as number } }),
      ).toThrow(RangeError);
      expect(() =>
        createRpcClient({
          endpoints: [{ url: PRIMARY }],
          timeouts: { connectMs: value as number },
        }),
      ).toThrow(RangeError);
    },
  );
});

describe('AttemptDeadline', () => {
  it('reports the timeout, not the abort error, for a read that settles after it expired', async () => {
    const deadline = new AttemptDeadline(
      { connectMs: 0, requestMs: 100 },
      { url: `${PRIMARY}/`, endpoint: PRIMARY, attempt: 1 },
    );
    await vi.advanceTimersByTimeAsync(100);

    await expect(deadline.read(Promise.reject(abortError()))).rejects.toBeInstanceOf(
      RPCTimeoutError,
    );
  });
});

describe('createRpcClient timeouts', () => {
  it('aborts a hung attempt at the connect timeout, then retries', async () => {
    const { fetchImpl, calls } = scriptedFetch({ [PRIMARY]: [hang, ok({ ledger: 7 })] });
    const client = createRpcClient({
      endpoints: [{ url: PRIMARY }],
      retry: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 10 },
      timeouts: { connectMs: 1_000, requestMs: 5_000 },
      fetchImpl,
    });

    const result = track(client.request('POST', '/', { method: 'getLatestLedger' }));
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toHaveLength(1);
    expect(calls[0].signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(calls[0].signal?.aborted).toBe(true);
    const reason = calls[0].signal?.reason as RPCTimeoutError;
    expect(reason).toBeInstanceOf(RPCTimeoutError);
    expect(reason).toMatchObject({
      url: `${PRIMARY}/`,
      endpoint: PRIMARY,
      attempt: 1,
      phase: 'connect',
      timeoutMs: 1_000,
    });

    await vi.runAllTimersAsync();
    expect(result.value).toEqual({ ledger: 7 });
    expect(calls).toHaveLength(2);
    expect(calls[1].earlierAborted).toEqual([true]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails over once timeouts trip the circuit breaker, aborting before it switches', async () => {
    const { fetchImpl, calls } = scriptedFetch({
      [PRIMARY]: [hang],
      [FALLBACK]: [ok({ from: 'fallback' })],
    });
    const client = createRpcClient({
      endpoints: [{ url: PRIMARY }, { url: FALLBACK }],
      circuitBreaker: { failureThreshold: 2, cooldownMs: 60_000 },
      retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 10 },
      timeouts: { connectMs: 500 },
      fetchImpl,
    });
    const failovers: Array<{ reason: string; primaryAborted: boolean[] }> = [];
    client.on('endpointFailover', ({ reason }) => {
      failovers.push({ reason, primaryAborted: calls.map((c) => c.signal?.aborted ?? false) });
    });

    const result = track(client.request('GET', '/'));
    await vi.runAllTimersAsync();

    expect(result.value).toEqual({ from: 'fallback' });
    expect(calls.map((c) => c.url)).toEqual([`${PRIMARY}/`, `${PRIMARY}/`, `${FALLBACK}/`]);
    expect(failovers).toEqual([
      {
        reason: `Timeout on ${PRIMARY}: connect timeout of 500ms`,
        primaryAborted: [true, true],
      },
    ]);
    expect(client.getHealthyEndpoint()).toBe(FALLBACK);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('throws RPCRetryExhaustedError whose cause names the endpoint and attempt that timed out', async () => {
    const { fetchImpl, calls } = scriptedFetch({ [PRIMARY]: [hang], [FALLBACK]: [hang] });
    const client = createRpcClient({
      endpoints: [{ url: PRIMARY }, { url: FALLBACK }],
      circuitBreaker: { failureThreshold: 2, cooldownMs: 60_000 },
      retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 10 },
      timeouts: { connectMs: 500 },
      fetchImpl,
    });

    const result = track(client.request('GET', '/'));
    await vi.runAllTimersAsync();

    expect(result.error).toBeInstanceOf(RPCRetryExhaustedError);
    const cause = (result.error as RPCRetryExhaustedError).cause;
    expect(cause).toBeInstanceOf(RPCTimeoutError);
    expect(cause).toMatchObject({
      url: `${FALLBACK}/`,
      endpoint: FALLBACK,
      attempt: 4,
      phase: 'connect',
      timeoutMs: 500,
    });
    expect(calls).toHaveLength(4);
    expect(calls.every((c) => c.signal?.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out a body that stalls after the headers and keeps counting it as a failure', async () => {
    const { fetchImpl, calls } = scriptedFetch({
      [PRIMARY]: [stallsMidBody],
      [FALLBACK]: [ok({ from: 'fallback' })],
    });
    const client = createRpcClient({
      endpoints: [{ url: PRIMARY }, { url: FALLBACK }],
      circuitBreaker: { failureThreshold: 2, cooldownMs: 60_000 },
      retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 10 },
      timeouts: { connectMs: 1_000, requestMs: 2_000 },
      fetchImpl,
    });
    const reasons: string[] = [];
    client.on('endpointFailover', ({ reason }) => reasons.push(reason));

    const result = track(client.request('GET', '/'));
    await vi.runAllTimersAsync();

    // Before the fix a 200 marked the endpoint healthy before the body was read, so each stalled
    // body reset the failure count and the client never failed over.
    expect(result.value).toEqual({ from: 'fallback' });
    expect(reasons).toEqual([`Timeout on ${PRIMARY}: request timeout of 2000ms`]);
    expect(calls[0].signal?.reason).toMatchObject({ phase: 'request', attempt: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still times out when fetch ignores the abort signal', async () => {
    const { fetchImpl, calls } = scriptedFetch({ [PRIMARY]: [ignoresAbort, ok({ ok: true })] });
    const client = createRpcClient({
      endpoints: [{ url: PRIMARY }],
      retry: { maxRetries: 1, baseDelayMs: 10, maxDelayMs: 10 },
      timeouts: { connectMs: 1_000 },
      fetchImpl,
    });

    const result = track(client.request('GET', '/'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls[0].signal?.aborted).toBe(true);

    await vi.runAllTimersAsync();
    expect(result.value).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('applies per-call timeouts over the client ones', async () => {
    const { fetchImpl, calls } = scriptedFetch({
      [PRIMARY]: [answersAfter(60_000, { slow: true })],
    });
    const client = createRpcClient({
      endpoints: [{ url: PRIMARY }],
      retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 10 },
      timeouts: { connectMs: 100 },
      fetchImpl,
    });

    const result = track(
      client.request('GET', '/', undefined, { timeouts: { connectMs: 0, requestMs: 0 } }),
    );
    await vi.advanceTimersByTimeAsync(60_000);

    expect(result.value).toEqual({ slow: true });
    expect(calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects an invalid per-call timeout without sending the request', async () => {
    const { fetchImpl } = scriptedFetch({ [PRIMARY]: [ok({})] });
    const client = createRpcClient({ endpoints: [{ url: PRIMARY }], fetchImpl });

    await expect(
      client.request('GET', '/', undefined, { timeouts: { requestMs: -5 } }),
    ).rejects.toThrow(RangeError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('clears its timers after a request that succeeds with the default timeouts', async () => {
    const { fetchImpl, calls } = scriptedFetch({ [PRIMARY]: [ok({ fine: true })] });
    const client = createRpcClient({ endpoints: [{ url: PRIMARY }], fetchImpl });

    await expect(client.request('GET', '/')).resolves.toEqual({ fine: true });
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the timers of an attempt that got a retryable status', async () => {
    const { fetchImpl } = scriptedFetch({ [PRIMARY]: [status(503), ok({ second: true })] });
    const client = createRpcClient({
      endpoints: [{ url: PRIMARY }],
      retry: { maxRetries: 1, baseDelayMs: 10, maxDelayMs: 10 },
      fetchImpl,
    });

    const result = track(client.request('GET', '/'));
    await vi.advanceTimersByTimeAsync(1);
    // Only the backoff sleep is left; the first attempt's timers are gone.
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(10);
    expect(result.value).toEqual({ second: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('createHorizonClient timeouts', () => {
  it('aborts a hung GET at the connect timeout, then retries', async () => {
    const { fetchImpl, calls } = scriptedFetch({ [HORIZON]: [hang, ok({ status: 'healthy' })] });
    const client = createHorizonClient({
      horizonUrl: HORIZON,
      retry: { maxRetries: 1, baseDelayMs: 10 },
      timeouts: { connectMs: 1_000 },
      fetchImpl,
    });

    const result = track(client.get('/health'));
    await vi.advanceTimersByTimeAsync(999);
    expect(calls[0].signal?.aborted).toBe(false);

    await vi.runAllTimersAsync();
    expect(result.value).toEqual({ status: 'healthy' });
    expect(calls).toHaveLength(2);
    expect(calls[1].earlierAborted).toEqual([true]);
    expect(calls[0].signal?.reason).toMatchObject({
      url: `${HORIZON}/health`,
      endpoint: HORIZON,
      attempt: 1,
      phase: 'connect',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('throws RPCRetryExhaustedError with the last timeout as its cause', async () => {
    const { fetchImpl, calls } = scriptedFetch({ [HORIZON]: [hang] });
    const client = createHorizonClient({
      horizonUrl: HORIZON,
      retry: { maxRetries: 2, baseDelayMs: 10 },
      timeouts: { connectMs: 1_000 },
      fetchImpl,
    });

    const result = track(client.get('/ledgers'));
    await vi.runAllTimersAsync();

    expect(result.error).toBeInstanceOf(RPCRetryExhaustedError);
    expect((result.error as RPCRetryExhaustedError).cause).toMatchObject({
      url: `${HORIZON}/ledgers`,
      endpoint: HORIZON,
      attempt: 3,
      phase: 'connect',
      timeoutMs: 1_000,
    });
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.signal?.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out a body that stalls after the headers', async () => {
    const { fetchImpl } = scriptedFetch({ [HORIZON]: [stallsMidBody, ok({ records: [] })] });
    const client = createHorizonClient({
      horizonUrl: HORIZON,
      retry: { maxRetries: 1, baseDelayMs: 10 },
      timeouts: { connectMs: 1_000, requestMs: 3_000 },
      fetchImpl,
    });

    const result = track(client.get('/operations'));
    await vi.advanceTimersByTimeAsync(2_999);
    expect(result.settled).toBe(false);

    await vi.runAllTimersAsync();
    expect(result.value).toEqual({ records: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('still times out when fetch ignores the abort signal', async () => {
    const { fetchImpl } = scriptedFetch({ [HORIZON]: [ignoresAbort] });
    const client = createHorizonClient({
      horizonUrl: HORIZON,
      retry: { maxRetries: 0 },
      timeouts: { requestMs: 2_000 },
      fetchImpl,
    });

    const result = track(client.get('/health'));
    await vi.advanceTimersByTimeAsync(2_000);

    expect(result.error).toBeInstanceOf(RPCRetryExhaustedError);
    expect((result.error as RPCRetryExhaustedError).cause).toMatchObject({
      phase: 'request',
      attempt: 1,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets one call raise its timeouts, e.g. a slow transaction submission', async () => {
    const { fetchImpl, calls } = scriptedFetch({
      [HORIZON]: [answersAfter(25_000, { hash: 'abc' })],
    });
    const client = createHorizonClient({
      horizonUrl: HORIZON,
      retry: { maxRetries: 0 },
      fetchImpl,
    });

    const result = track(
      client.post('/transactions', new URLSearchParams({ tx: 'AAAA' }), {
        timeouts: { connectMs: 60_000, requestMs: 60_000 },
      }),
    );
    await vi.advanceTimersByTimeAsync(25_000);

    expect(result.value).toEqual({ hash: 'abc' });
    expect(calls).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${HORIZON}/transactions`,
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
    );
  });

  it('clears its timers after a request that succeeds with the default timeouts', async () => {
    const { fetchImpl } = scriptedFetch({ [HORIZON]: [ok({ status: 'healthy' })] });
    const client = createHorizonClient({ horizonUrl: HORIZON, fetchImpl });

    await expect(client.get('/health')).resolves.toEqual({ status: 'healthy' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the timers of an attempt that got a retryable status', async () => {
    const { fetchImpl } = scriptedFetch({ [HORIZON]: [status(503), ok({ second: true })] });
    const client = createHorizonClient({
      horizonUrl: HORIZON,
      retry: { maxRetries: 1, baseDelayMs: 10 },
      fetchImpl,
    });

    const result = track(client.get('/health'));
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(10);
    expect(result.value).toEqual({ second: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});
