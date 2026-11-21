import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchStealthCells } from '../../../src/chains/ckb/announcements';
import { RPCRequestError, RPCResponseError } from '../../../src/errors';
import { cellRecord, cellsPage, LOCK_ARGS, TX_HASH } from './fixtures/indexer';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

function mockFetch(handler: () => Response | Promise<Response>) {
  const spy = vi.fn(handler);
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
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

    const [cell] = await fetchStealthCells();

    expect(cell.txHash).toBe(TX_HASH);
    expect(cell.index).toBe(7);
    expect(cell.capacity).toBe(100_000_000_000n);
    expect(cell.lockArgs).toBe(LOCK_ARGS);
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
    const spy = mockFetch(() => jsonResponse(cellsPage([cellRecord()])));
    spy.mockResolvedValueOnce(jsonResponse(cellsPage([cellRecord()], { cursor: 'cursor-2' })));
    spy.mockResolvedValueOnce(jsonResponse(cellsPage([cellRecord()], { cursor: null })));

    const result = await fetchStealthCells();

    expect(spy).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
  });

  test('stops when the indexer repeats its cursor', async () => {
    let call = 0;
    const spy = mockFetch(() => {
      call += 1;
      return jsonResponse(cellsPage([cellRecord()], { cursor: call === 1 ? 'same' : 'same' }));
    });

    await fetchStealthCells();

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

    const error = await fetchStealthCells().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RPCRequestError);
    expect((error as RPCRequestError).statusCode).toBe(502);
  });
});
