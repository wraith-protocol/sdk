import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchAnnouncements, fetchAnnouncementsPage } from '../../../src/chains/evm/announcements';
import {
  AnnouncementCursorError,
  AnnouncementProviderError,
  AnnouncementBudgetExceededError,
  RPCAbortedError,
  RPCRequestError,
  RPCRetryExhaustedError,
  RPCTimeoutError,
} from '../../../src/errors';

function announcement(index: number) {
  return {
    schemeId: '1',
    stealthAddress: `0x${'11'.repeat(20)}`,
    caller: `0x${'22'.repeat(20)}`,
    ephemeralPubKey: `0x${'33'.repeat(33)}`,
    metadata: `0x${index.toString(16).padStart(2, '0')}`,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function page(count: number, start = 0) {
  return {
    data: { announcements: Array.from({ length: count }, (_, i) => announcement(start + i)) },
  };
}

function mockFetchQueue(responses: Array<Response | (() => Promise<Response>)>) {
  let call = 0;
  const spy = vi.fn(() => {
    const next = responses[Math.min(call++, responses.length - 1)];
    return typeof next === 'function' ? next() : Promise.resolve(next);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('EVM fetchAnnouncements resilience', () => {
  test('times out a fetch that never answers', async () => {
    mockFetchQueue([() => new Promise<Response>(() => {})]);

    await expect(
      fetchAnnouncements('horizen', {
        timeouts: { requestMs: 25 },
        retry: { maxRetries: 0 },
      }),
    ).rejects.toBeInstanceOf(RPCTimeoutError);
  });

  test('rejects an already-aborted signal without sending a request', async () => {
    const spy = mockFetchQueue([jsonResponse(page(1))]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchAnnouncements('horizen', { signal: controller.signal }),
    ).rejects.toBeInstanceOf(RPCAbortedError);
    expect(spy).not.toHaveBeenCalled();
  });

  test('aborts an in-flight request and reports RPCAbortedError', async () => {
    mockFetchQueue([() => new Promise<Response>(() => {})]);
    const controller = new AbortController();

    const promise = fetchAnnouncements('horizen', { signal: controller.signal });
    const assertion = expect(promise).rejects.toBeInstanceOf(RPCAbortedError);
    controller.abort();
    await assertion;
  });

  test('retries rate-limited responses with backoff', async () => {
    const spy = mockFetchQueue([
      jsonResponse({ errors: [{ message: 'rate limited' }] }, 429),
      jsonResponse(page(1)),
    ]);

    const result = await fetchAnnouncements('horizen', {
      pageSize: 2,
      retry: { maxRetries: 1, baseDelayMs: 0 },
    });

    expect(result).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test('throws RPCRetryExhaustedError when retryable failures persist', async () => {
    mockFetchQueue([jsonResponse({}, 503)]);
    await expect(
      fetchAnnouncements('horizen', { retry: { maxRetries: 2, baseDelayMs: 0 } }),
    ).rejects.toBeInstanceOf(RPCRetryExhaustedError);
  });

  test('throws a typed RPC error for a non-retryable status', async () => {
    mockFetchQueue([jsonResponse({ message: 'bad request' }, 400)]);
    await expect(fetchAnnouncements('horizen')).rejects.toMatchObject({
      name: 'RPCRequestError',
      statusCode: 400,
    } satisfies Partial<RPCRequestError>);
  });

  test('reports GraphQL provider errors as AnnouncementProviderError', async () => {
    mockFetchQueue([jsonResponse({ errors: [{ message: 'subgraph unavailable' }] })]);
    await expect(fetchAnnouncements('horizen')).rejects.toBeInstanceOf(AnnouncementProviderError);
  });

  test('rejects a malformed cursor before fetching', async () => {
    const spy = mockFetchQueue([jsonResponse(page(0))]);
    await expect(fetchAnnouncements('horizen', { cursor: 'not-a-skip' })).rejects.toMatchObject({
      name: 'AnnouncementCursorError',
      reason: 'malformed',
    } satisfies Partial<AnnouncementCursorError>);
    expect(spy).not.toHaveBeenCalled();
  });

  test('stops at the maximum-page budget with partial progress and a resume cursor', async () => {
    const spy = mockFetchQueue([jsonResponse(page(2))]);

    const error = await fetchAnnouncements('horizen', { pageSize: 2, maxPages: 2 }).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(AnnouncementBudgetExceededError);
    const budgetError = error as AnnouncementBudgetExceededError;
    expect(budgetError.budget).toBe('pages');
    expect(budgetError.fetched).toBe(4);
    expect(budgetError.partial).toHaveLength(4);
    expect(budgetError.cursor).toBe('4');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test('resumes from the budget cursor and finishes the stream', async () => {
    const spy = mockFetchQueue([jsonResponse(page(1, 4))]);

    const result = await fetchAnnouncements('horizen', {
      pageSize: 2,
      cursor: '4',
      maxPages: 2,
    });

    expect(result).toHaveLength(1);
    const body = JSON.parse(spy.mock.calls[0]?.[1]?.body as string);
    expect(body.variables).toEqual({ first: 2, skip: 4 });
  });

  test('stops at the item budget without allocating past it', async () => {
    mockFetchQueue([jsonResponse(page(3))]);

    const error = await fetchAnnouncements('horizen', {
      pageSize: 3,
      maxItems: 2,
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AnnouncementBudgetExceededError);
    const budgetError = error as AnnouncementBudgetExceededError;
    expect(budgetError.budget).toBe('items');
    expect(budgetError.fetched).toBe(2);
    expect(budgetError.partial).toHaveLength(2);
    expect(budgetError.cursor).toBe('3');
  });

  test('fetches a single page and exposes the cursor', async () => {
    mockFetchQueue([jsonResponse(page(2))]);

    const result = await fetchAnnouncementsPage('horizen', { pageSize: 2 });

    expect(result.pages).toBe(1);
    expect(result.hasMore).toBe(true);
    expect(result.cursor).toBe('2');
    expect(result.announcements).toHaveLength(2);
  });
});
