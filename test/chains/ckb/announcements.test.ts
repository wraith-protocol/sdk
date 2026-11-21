import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchStealthCells, fetchStealthCellsPage } from '../../../src/chains/ckb/announcements';
import {
  AnnouncementBudgetExceededError,
  AnnouncementCursorError,
  RPCAbortedError,
  RPCRequestError,
  RPCResponseError,
  RPCRetryExhaustedError,
  RPCTimeoutError,
} from '../../../src/errors';
import { cellRecord, cellsPage, LOCK_ARGS, TX_HASH } from './fixtures/indexer';

function cell(txSeed: string) {
  return {
    out_point: { tx_hash: `0x${txSeed.repeat(64).slice(0, 64)}`, index: '0x0' },
    output: {
      capacity: '0x174876e800',
      lock: { args: LOCK_ARGS },
    },
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

function page(objects: unknown[], lastCursor?: string) {
  return { result: { objects, last_cursor: lastCursor } };
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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('CKB fetchStealthCells resilience', () => {
  test('times out a fetch that never answers', async () => {
    mockFetchQueue([() => new Promise<Response>(() => {})]);

    await expect(
      fetchStealthCells('ckb', {
        timeouts: { requestMs: 25 },
        retry: { maxRetries: 0 },
      }),
    ).rejects.toBeInstanceOf(RPCTimeoutError);
  });

  test('rejects an already-aborted signal without sending a request', async () => {
    const spy = mockFetchQueue([jsonResponse(page([]))]);
    const controller = new AbortController();
    controller.abort();

    await expect(fetchStealthCells('ckb', { signal: controller.signal })).rejects.toBeInstanceOf(
      RPCAbortedError,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  test('aborts an in-flight request', async () => {
    mockFetchQueue([() => new Promise<Response>(() => {})]);
    const controller = new AbortController();

    const promise = fetchStealthCells('ckb', { signal: controller.signal });
    const assertion = expect(promise).rejects.toBeInstanceOf(RPCAbortedError);
    controller.abort();
    await assertion;
  });

  test('retries HTTP 502 then succeeds', async () => {
    const spy = mockFetchQueue([jsonResponse({}, 502), jsonResponse(page([cell('a')], undefined))]);

    const result = await fetchStealthCells('ckb', {
      retry: { maxRetries: 1, baseDelayMs: 0 },
    });

    expect(result).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test('throws RPCRetryExhaustedError when retryable failures persist', async () => {
    mockFetchQueue([jsonResponse({}, 503)]);
    await expect(
      fetchStealthCells('ckb', { retry: { maxRetries: 1, baseDelayMs: 0 } }),
    ).rejects.toBeInstanceOf(RPCRetryExhaustedError);
  });

  test('reports a JSON-RPC error as RPCResponseError', async () => {
    mockFetchQueue([jsonResponse({ error: { code: -1, message: 'indexer unavailable' } })]);
    await expect(fetchStealthCells('ckb')).rejects.toBeInstanceOf(RPCResponseError);
  });

  test('rejects a malformed resume cursor before fetching', async () => {
    const spy = mockFetchQueue([jsonResponse(page([]))]);
    await expect(fetchStealthCells('ckb', { cursor: 'not-hex' })).rejects.toMatchObject({
      name: 'AnnouncementCursorError',
      reason: 'malformed',
    } satisfies Partial<AnnouncementCursorError>);
    expect(spy).not.toHaveBeenCalled();
  });

  test('rejects a repeated provider cursor instead of looping forever', async () => {
    const spy = mockFetchQueue([
      jsonResponse(page([cell('a')], '0x01')),
      jsonResponse(page([cell('b')], '0x01')),
    ]);

    await expect(fetchStealthCells('ckb', { pageSize: 1 })).rejects.toMatchObject({
      name: 'AnnouncementCursorError',
      reason: 'repeated',
    } satisfies Partial<AnnouncementCursorError>);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test('stops at the maximum-page budget with partial progress and a resume cursor', async () => {
    const spy = mockFetchQueue([
      jsonResponse(page([cell('a')], '0x01')),
      jsonResponse(page([cell('b')], '0x02')),
    ]);

    const error = await fetchStealthCells('ckb', { pageSize: 1, maxPages: 2 }).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(AnnouncementBudgetExceededError);
    const budgetError = error as AnnouncementBudgetExceededError;
    expect(budgetError.budget).toBe('pages');
    expect(budgetError.fetched).toBe(2);
    expect(budgetError.partial).toHaveLength(2);
    expect(budgetError.cursor).toBe('0x02');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test('resumes from the budget cursor and finishes', async () => {
    const spy = mockFetchQueue([jsonResponse(page([cell('c')], undefined))]);

    const result = await fetchStealthCells('ckb', { pageSize: 1, cursor: '0x02' });

    expect(result).toHaveLength(1);
    const body = JSON.parse(spy.mock.calls[0]?.[1]?.body as string);
    expect(body.params[3]).toBe('0x02');
    expect(body.params[2]).toBe('0x1');
  });

  test('stops at the item budget', async () => {
    mockFetchQueue([jsonResponse(page([cell('a'), cell('b'), cell('c')], '0x03'))]);

    const error = await fetchStealthCells('ckb', { pageSize: 3, maxItems: 2 }).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(AnnouncementBudgetExceededError);
    const budgetError = error as AnnouncementBudgetExceededError;
    expect(budgetError.budget).toBe('items');
    expect(budgetError.partial).toHaveLength(2);
  });

  test('fetches a single page and exposes the cursor', async () => {
    mockFetchQueue([jsonResponse(page([cell('a')], '0x09'))]);

    const result = await fetchStealthCellsPage('ckb', { pageSize: 1 });

    expect(result.pages).toBe(1);
    expect(result.hasMore).toBe(true);
    expect(result.cursor).toBe('0x09');
    expect(result.announcements).toHaveLength(1);
  });
});

describe('fetchStealthCells (CKB indexer validation)', () => {
  test('returns validated cells from a standard result envelope', async () => {
    mockFetch(() => jsonResponse(cellsPage()));

    const result = await fetchStealthCells();

    expect(result).toHaveLength(1);
    expect(result[0].txHash).toBe(TX_HASH);
    expect(result[0].index).toBe(0);
    expect(result[0].capacity).toBe(100_000_000_000n);
    expect(result[0].lockArgs).toBe(LOCK_ARGS);
    expect(result[0].ephemeralPubKey).toBe(`0x${LOCK_ARGS.slice(2, 68)}`);
    expect(result[0].stealthPubKeyHash).toBe(`0x${LOCK_ARGS.slice(68)}`);
  });

  test('accepts the data wrapper some gateways return', async () => {
    mockFetch(() => jsonResponse(cellsPage([cellRecord()], { variant: 'data' })));

    await expect(fetchStealthCells()).resolves.toHaveLength(1);
  });

  test('normalizes bare hashes, decimal capacities and numeric indexes', async () => {
    mockFetch(() =>
      jsonResponse(
        cellsPage([
          cellRecord({
            out_point: { tx_hash: TX_HASH.slice(2).toUpperCase(), index: 7 },
            output: {
              capacity: '100000000000',
              lock: { args: LOCK_ARGS.toUpperCase().replace('0X', '0x') },
            },
          }),
        ]),
      ),
    );

    const [cellValue] = await fetchStealthCells();

    expect(cellValue.txHash).toBe(TX_HASH);
    expect(cellValue.index).toBe(7);
    expect(cellValue.capacity).toBe(100_000_000_000n);
    expect(cellValue.lockArgs).toBe(LOCK_ARGS);
  });

  test('skips cells whose lock args are empty', async () => {
    mockFetch(() =>
      jsonResponse(
        cellsPage([
          cellRecord({ output: { capacity: '0x1', lock: { args: '0x' } } }),
          cellRecord(),
        ]),
      ),
    );

    const result = await fetchStealthCells();

    expect(result).toHaveLength(1);
  });

  test('pages until the indexer has no cursor', async () => {
    const spy = mockFetchQueue([
      jsonResponse(cellsPage([cellRecord()], { cursor: '0x02' })),
      jsonResponse(cellsPage([cellRecord()], { cursor: null })),
    ]);

    const result = await fetchStealthCells();

    expect(spy).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
  });

  test('stops when the indexer repeats its cursor', async () => {
    const spy = mockFetchQueue([
      jsonResponse(cellsPage([cellRecord()], { cursor: '0x01' })),
      jsonResponse(cellsPage([cellRecord()], { cursor: '0x01' })),
    ]);

    await expect(fetchStealthCells()).rejects.toMatchObject({
      name: 'AnnouncementCursorError',
      reason: 'repeated',
    } satisfies Partial<AnnouncementCursorError>);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test.each([
    ['non-object body', null, 'body'],
    ['array body', [], 'body'],
    ['missing result', {}, 'body.result'],
    ['null result', { result: null }, 'body.result'],
    ['null objects', { result: { objects: null } }, 'result.objects'],
    ['string objects', { result: { objects: 'cells' } }, 'result.objects'],
    [
      'too many objects',
      { result: { objects: Array.from({ length: 101 }, () => cellRecord()) } },
      'result.objects',
    ],
    ['non-object cell', { result: { objects: [null] } }, 'result.objects[0]'],
    ['missing out_point', { result: { objects: [cellRecord({ out_point: null })] } }, 'out_point'],
    ['missing output', { result: { objects: [cellRecord({ output: null })] } }, 'output'],
    [
      'missing lock',
      { result: { objects: [cellRecord({ output: { capacity: '0x1' } })] } },
      'lock',
    ],
    ['non-string cursor', { result: { objects: [], last_cursor: 42 } }, 'last_cursor'],
  ])('rejects %s', async (_label, payload, field) => {
    mockFetch(() => jsonResponse(payload));

    const error = await fetchStealthCells().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RPCResponseError);
    expect((error as RPCResponseError).field).toContain(field);
    expect((error as RPCResponseError).chain).toBe('ckb');
    expect((error as RPCResponseError).operation).toBe('fetchStealthCells');
  });

  test('reports a JSON-RPC error without echoing its message', async () => {
    mockFetch(() => jsonResponse({ error: { code: -32000, message: 'SECRET_INDEXER_MESSAGE' } }));

    const error = (await fetchStealthCells().catch((err: unknown) => err)) as Error;

    expect(error).toBeInstanceOf(RPCResponseError);
    expect(error.message).toContain('-32000');
    expect(error.message).not.toContain('SECRET_INDEXER_MESSAGE');
  });

  test.each([
    ['null tx hash', { out_point: { tx_hash: null, index: '0x0' } }, 'tx_hash'],
    ['short tx hash', { out_point: { tx_hash: '0x' + 'ab'.repeat(31), index: '0x0' } }, 'tx_hash'],
    [
      'non-hex tx hash',
      { out_point: { tx_hash: '0x' + 'zz'.repeat(32), index: '0x0' } },
      'tx_hash',
    ],
    ['null index', { out_point: { tx_hash: TX_HASH, index: null } }, 'index'],
    ['fractional index', { out_point: { tx_hash: TX_HASH, index: 1.5 } }, 'index'],
    ['negative index', { out_point: { tx_hash: TX_HASH, index: '-1' } }, 'index'],
    ['oversized index', { out_point: { tx_hash: TX_HASH, index: '0x100000000' } }, 'index'],
    ['null capacity', { output: { capacity: null, lock: { args: LOCK_ARGS } } }, 'capacity'],
    ['negative capacity', { output: { capacity: '-1', lock: { args: LOCK_ARGS } } }, 'capacity'],
    ['fractional capacity', { output: { capacity: 1.5, lock: { args: LOCK_ARGS } } }, 'capacity'],
    [
      'oversized capacity',
      { output: { capacity: '0x10000000000000000', lock: { args: LOCK_ARGS } } },
      'capacity',
    ],
    ['null args', { output: { capacity: '0x1', lock: { args: null } } }, 'args'],
    ['odd args', { output: { capacity: '0x1', lock: { args: '0x1' } } }, 'args'],
    [
      'non-hex args',
      { output: { capacity: '0x1', lock: { args: '0x' + 'zz'.repeat(53) } } },
      'args',
    ],
    ['short args', { output: { capacity: '0x1', lock: { args: '0x' + 'ab'.repeat(52) } } }, 'args'],
    ['long args', { output: { capacity: '0x1', lock: { args: '0x' + 'ab'.repeat(54) } } }, 'args'],
  ])('rejects a cell with %s', async (_label, overrides, field) => {
    mockFetch(() => jsonResponse(cellsPage([cellRecord(overrides)])));

    const error = await fetchStealthCells().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RPCResponseError);
    expect((error as RPCResponseError).field).toContain(field);
  });

  test('rejects oversized and malformed bodies', async () => {
    mockFetch(
      () =>
        new Response('{}', {
          headers: { 'content-type': 'application/json', 'content-length': '2000000' },
        }),
    );
    const oversized = await fetchStealthCells().catch((err: unknown) => err);
    expect(oversized).toBeInstanceOf(RPCResponseError);
    expect((oversized as RPCResponseError).field).toBe('body');

    mockFetch(() => jsonResponse('{"result":'));
    const malformed = await fetchStealthCells().catch((err: unknown) => err);
    expect(malformed).toBeInstanceOf(RPCResponseError);
    expect((malformed as RPCResponseError).field).toBe('body');
  });

  test('surfaces a non-2xx status as RPCRequestError', async () => {
    mockFetch(() => new Response('down', { status: 502 }));

    const error = await fetchStealthCells('ckb', { retry: { maxRetries: 0 } }).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(RPCRequestError);
    expect((error as RPCRequestError).statusCode).toBe(502);
  });
});
