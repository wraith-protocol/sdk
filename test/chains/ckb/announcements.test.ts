import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchStealthCells, fetchStealthCellsPage } from '../../../src/chains/ckb/announcements';
import {
  AnnouncementBudgetExceededError,
  AnnouncementCursorError,
  AnnouncementProviderError,
  RPCAbortedError,
  RPCRetryExhaustedError,
  RPCTimeoutError,
} from '../../../src/errors';

const LOCK_ARGS = `0x${'ab'.repeat(53)}`;

function cell(txSeed: string) {
  return {
    out_point: { tx_hash: `0x${txSeed.repeat(32).slice(0, 64)}`, index: '0x0' },
    output: {
      capacity: '0x174876e800',
      lock: { args: LOCK_ARGS },
    },
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

  test('reports a JSON-RPC error as AnnouncementProviderError', async () => {
    mockFetchQueue([jsonResponse({ error: { code: -1, message: 'indexer unavailable' } })]);
    await expect(fetchStealthCells('ckb')).rejects.toBeInstanceOf(AnnouncementProviderError);
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
