import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchAnnouncements, fetchAnnouncementsPage } from '../../../src/chains/evm/announcements';
import {
  AnnouncementBudgetExceededError,
  AnnouncementCursorError,
  RPCAbortedError,
  RPCRequestError,
  RPCResponseError,
  RPCRetryExhaustedError,
  RPCTimeoutError,
} from '../../../src/errors';
import {
  announcementRecord,
  CALLER,
  EPHEMERAL_PUB_KEY,
  METADATA,
  STEALTH_ADDRESS,
  subgraphPage,
} from './fixtures/subgraph';

function announcement(index: number) {
  return {
    schemeId: '1',
    stealthAddress: `0x${'11'.repeat(20)}`,
    caller: `0x${'22'.repeat(20)}`,
    ephemeralPubKey: `0x${'33'.repeat(33)}`,
    metadata: `0x${index.toString(16).padStart(2, '0')}`,
  };
}

function jsonResponse(body: unknown, init: ResponseInit | number = {}): Response {
  const options = typeof init === 'number' ? { status: init } : init;
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: (options.status ?? 200) >= 200 && (options.status ?? 200) < 300,
    status: options.status ?? 200,
    headers: new Headers({ 'content-type': 'application/json', ...options.headers }),
    // A fresh stream per read keeps queued responses reusable across paged calls.
    get body() {
      return new Response(text).body;
    },
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
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

function mockFetch(handler: () => Response | Promise<Response>) {
  const spy = vi.fn(handler);
  vi.stubGlobal('fetch', spy);
  return spy;
}

function paginatedFetch(total: number) {
  const spy = vi.fn((_input: unknown, init?: RequestInit) => {
    const { first, skip } = (
      JSON.parse(init?.body as string) as { variables: { first: number; skip: number } }
    ).variables;
    const count = Math.max(0, Math.min(first, total - skip));
    const announcements = Array.from({ length: count }, (_, i) => announcement(skip + i));
    return Promise.resolve(jsonResponse({ data: { announcements } }));
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

  test('reports GraphQL provider errors as RPCResponseError', async () => {
    mockFetchQueue([jsonResponse({ errors: [{ message: 'subgraph unavailable' }] })]);
    await expect(fetchAnnouncements('horizen')).rejects.toBeInstanceOf(RPCResponseError);
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
    const spy = paginatedFetch(5);

    const error = await fetchAnnouncements('horizen', {
      pageSize: 3,
      maxItems: 2,
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AnnouncementBudgetExceededError);
    const budgetError = error as AnnouncementBudgetExceededError;
    expect(budgetError.budget).toBe('items');
    expect(budgetError.fetched).toBe(2);
    expect(budgetError.partial).toHaveLength(2);
    expect(budgetError.cursor).toBe('2');
    const body = JSON.parse(spy.mock.calls[0]?.[1]?.body as string);
    expect(body.variables).toEqual({ first: 2, skip: 0 });
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

describe('fetchAnnouncements (EVM subgraph validation)', () => {
  test('returns normalized announcements for a valid page', async () => {
    mockFetch(() =>
      jsonResponse(
        subgraphPage([
          announcementRecord({ stealthAddress: STEALTH_ADDRESS.toUpperCase().replace('0X', '0x') }),
        ]),
      ),
    );

    const result = await fetchAnnouncements('horizen');

    expect(result).toEqual([
      {
        schemeId: 1n,
        stealthAddress: STEALTH_ADDRESS,
        caller: CALLER,
        ephemeralPubKey: EPHEMERAL_PUB_KEY,
        metadata: METADATA,
      },
    ]);
  });

  test.each(['plain', 'result', 'double-data', 'nodes'] as const)(
    'normalizes the %s provider envelope',
    async (variant) => {
      mockFetch(() => jsonResponse(subgraphPage([announcementRecord()], variant)));

      const result = await fetchAnnouncements('horizen');

      expect(result).toHaveLength(1);
      expect(result[0].stealthAddress).toBe(STEALTH_ADDRESS);
    },
  );

  test.each([
    ['number', 1],
    ['decimal string', '1'],
    ['hex string', '0x1'],
  ])('accepts schemeId as a %s', async (_label, schemeId) => {
    mockFetch(() => jsonResponse(subgraphPage([announcementRecord({ schemeId })])));

    const result = await fetchAnnouncements('horizen');

    expect(result[0].schemeId).toBe(1n);
  });

  test('normalizes absent and bare metadata', async () => {
    mockFetch(() =>
      jsonResponse(
        subgraphPage([
          announcementRecord({ metadata: null }),
          announcementRecord({ metadata: undefined }),
          announcementRecord({ metadata: '0x' }),
        ]),
      ),
    );

    const result = await fetchAnnouncements('horizen');

    expect(result.map((announcement) => announcement.metadata)).toEqual(['0x', '0x', '0x']);
  });

  test('pages through the subgraph until a short page', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, i) =>
      announcementRecord({ stealthAddress: `0x${i.toString(16).padStart(40, '0')}` }),
    );
    const spy = mockFetchQueue([
      jsonResponse(subgraphPage(firstPage)),
      jsonResponse(subgraphPage([announcementRecord()])),
    ]);

    const result = await fetchAnnouncements('horizen');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1001);
  });

  test.each([
    ['non-object body', null, 'body'],
    ['array body', [], 'body'],
    ['missing data', {}, 'data.announcements'],
    ['null data', { data: null }, 'data.announcements'],
    ['null announcements', { data: { announcements: null } }, 'data.announcements'],
    ['string announcements', { data: { announcements: 'nope' } }, 'data.announcements'],
    ['null nodes', { data: { announcements: { nodes: null } } }, 'data.announcements.nodes'],
    ['non-object record', subgraphPage([null]), 'data.announcements[0]'],
    [
      'graphql errors',
      { errors: [{ message: 'boom' }], data: { announcements: [] } },
      'body.errors',
    ],
  ])('rejects %s', async (_label, payload, field) => {
    mockFetch(() => jsonResponse(payload));

    const error = await fetchAnnouncements('horizen').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RPCResponseError);
    expect((error as RPCResponseError).field).toContain(field);
    expect((error as RPCResponseError).chain).toBe('horizen');
    expect((error as RPCResponseError).operation).toBe('fetchAnnouncements');
  });

  test.each([
    ['null schemeId', { schemeId: null }, 'schemeId'],
    ['boolean schemeId', { schemeId: true }, 'schemeId'],
    ['fractional schemeId', { schemeId: 1.5 }, 'schemeId'],
    ['negative schemeId', { schemeId: '-1' }, 'schemeId'],
    ['exponent schemeId', { schemeId: '1e3' }, 'schemeId'],
    ['oversized schemeId', { schemeId: '9'.repeat(65) }, 'schemeId'],
    ['null stealth address', { stealthAddress: null }, 'stealthAddress'],
    ['short stealth address', { stealthAddress: '0x' + '11'.repeat(19) }, 'stealthAddress'],
    ['non-hex stealth address', { stealthAddress: '0x' + 'zz'.repeat(20) }, 'stealthAddress'],
    ['null caller', { caller: null }, 'caller'],
    ['null ephemeral key', { ephemeralPubKey: null }, 'ephemeralPubKey'],
    ['short ephemeral key', { ephemeralPubKey: '0x' + '33'.repeat(32) }, 'ephemeralPubKey'],
    ['numeric metadata', { metadata: 123 }, 'metadata'],
    ['odd metadata', { metadata: '0x1' }, 'metadata'],
    ['non-hex metadata', { metadata: '0xzz' }, 'metadata'],
    ['oversized metadata', { metadata: '0x' + 'aa'.repeat(4097) }, 'metadata'],
  ])('rejects a record with %s', async (_label, overrides, field) => {
    mockFetch(() => jsonResponse(subgraphPage([announcementRecord(overrides)])));

    const error = await fetchAnnouncements('horizen').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RPCResponseError);
    expect((error as RPCResponseError).field).toContain(field);
  });

  test('does not echo untrusted values in the error message', async () => {
    const secret = 'SUPER_SECRET_PAYLOAD_MARKER';
    mockFetch(() => jsonResponse(subgraphPage([announcementRecord({ stealthAddress: secret })])));

    const error = (await fetchAnnouncements('horizen').catch((err: unknown) => err)) as Error;

    expect(error).toBeInstanceOf(RPCResponseError);
    expect(error.message).not.toContain(secret);
    expect(error.message).toContain('horizen');
    expect(error.message).toContain('fetchAnnouncements');
  });

  test('rejects a declared oversize body before reading it', async () => {
    mockFetch(
      () =>
        new Response('{}', {
          headers: { 'content-type': 'application/json', 'content-length': '2000000' },
        }),
    );

    const error = (await fetchAnnouncements('horizen').catch((err: unknown) => err)) as Error;

    expect(error).toBeInstanceOf(RPCResponseError);
    expect((error as RPCResponseError).field).toBe('body');
  });

  test('rejects a streamed body that exceeds the size limit', async () => {
    const chunk = new Uint8Array(600 * 1024).fill(0x20);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    mockFetch(() => new Response(stream, { headers: { 'content-type': 'application/json' } }));

    const error = (await fetchAnnouncements('horizen').catch((err: unknown) => err)) as Error;

    expect(error).toBeInstanceOf(RPCResponseError);
    expect((error as RPCResponseError).field).toBe('body');
  });

  test('rejects invalid JSON', async () => {
    mockFetch(() => jsonResponse('{"data":'));

    const error = await fetchAnnouncements('horizen').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RPCResponseError);
    expect((error as RPCResponseError).field).toBe('body');
  });

  test('surfaces a non-2xx status as RPCRequestError', async () => {
    mockFetch(() => new Response('upstream down', { status: 503 }));

    const error = await fetchAnnouncements('horizen', { retry: { maxRetries: 0 } }).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(RPCRequestError);
    expect((error as RPCRequestError).statusCode).toBe(503);
  });
});
