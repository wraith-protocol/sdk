import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchAnnouncements } from '../../../src/chains/evm/announcements';
import { RPCRequestError, RPCResponseError } from '../../../src/errors';
import {
  announcementRecord,
  CALLER,
  EPHEMERAL_PUB_KEY,
  METADATA,
  STEALTH_ADDRESS,
  subgraphPage,
} from './fixtures/subgraph';

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
    const spy = mockFetch(() => jsonResponse(subgraphPage(firstPage)));
    spy.mockResolvedValueOnce(jsonResponse(subgraphPage(firstPage)));
    spy.mockResolvedValueOnce(jsonResponse(subgraphPage([announcementRecord()])));

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

    const error = await fetchAnnouncements('horizen').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RPCRequestError);
    expect((error as RPCRequestError).statusCode).toBe(503);
  });
});
