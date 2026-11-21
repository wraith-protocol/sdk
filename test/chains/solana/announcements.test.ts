import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  fetchAnnouncements,
  fetchAnnouncementsPage,
} from '../../../src/chains/solana/announcements';
import { base58Encode } from '../../../src/chains/solana/utils';
import {
  createBoundedSolanaFetch,
  MAX_ANNOUNCEMENT_METADATA_BYTES,
  parseAnnouncementLogs,
  parseSignaturePage,
  parseTransactionLogs,
} from '../../../src/chains/solana/validation';
import {
  AnnouncementBudgetExceededError,
  AnnouncementCursorError,
  AnnouncementProviderError,
  RPCAbortedError,
  RPCResponseError,
  RPCTimeoutError,
} from '../../../src/errors';
import type { RPCResponseContext } from '../../../src/chains/rpcValidation';
import { ANNOUNCEMENT_EVENT_DISCRIMINATOR, announcementEvent, programData } from './fixtures/logs';

const context: RPCResponseContext = { chain: 'solana', operation: 'fetchAnnouncements' };

const mocks = vi.hoisted(() => ({
  getSignatures: vi.fn(),
  getTransaction: vi.fn(),
  constructed: vi.fn(),
}));

vi.mock('@solana/web3.js', () => {
  class PublicKey {
    constructor(_value: unknown) {}
    toBase58(): string {
      return '11111111111111111111111111111111';
    }
  }
  class Connection {
    constructor(url: string, options: unknown) {
      mocks.constructed(url, options);
    }
    getSignaturesForAddress = mocks.getSignatures;
    getTransaction = mocks.getTransaction;
  }
  return { Connection, PublicKey };
});

const SIG_A = '1'.repeat(64);
const SIG_B = '2'.repeat(64);

function announcementLog(): string {
  const metadata = new Uint8Array([0xde, 0xad]);
  const bytes = new Uint8Array(8 + 4 + 32 + 32 + 32 + 4 + metadata.length);
  [0xfa, 0xb0, 0x2a, 0xef, 0x3c, 0xad, 0x36, 0x88].forEach((b, i) => {
    bytes[i] = b;
  });
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 1, true);
  bytes.fill(0x01, 12, 44);
  bytes.fill(0x02, 44, 76);
  bytes.fill(0x03, 76, 108);
  view.setUint32(108, metadata.length, true);
  bytes.set(metadata, 112);
  return `Program data: ${Buffer.from(bytes).toString('base64')}`;
}

const TX_WITH_ANNOUNCEMENT = { meta: { logMessages: [announcementLog()] } };

beforeEach(() => {
  mocks.getSignatures.mockReset();
  mocks.getTransaction.mockReset();
  mocks.constructed.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('parseAnnouncementLogs', () => {
  test('decodes a valid announcement event', () => {
    const [announcement] = parseAnnouncementLogs(
      [announcementEvent()],
      context,
      'result.meta.logMessages',
    );

    expect(announcement.schemeId).toBe(1);
    expect(announcement.stealthAddress).toBe(
      base58Encode(Uint8Array.from({ length: 32 }, () => 0x11)),
    );
    expect(announcement.caller).toBe(base58Encode(Uint8Array.from({ length: 32 }, () => 0x22)));
    expect(announcement.ephemeralPubKey).toBe('33'.repeat(32));
    expect(announcement.metadata).toBe('07');
  });

  test('accepts base64url provider variants', () => {
    const bytes = new Uint8Array(112 + 3);
    bytes.set(ANNOUNCEMENT_EVENT_DISCRIMINATOR, 0);
    new DataView(bytes.buffer).setUint32(8, 1, true);
    bytes.set(
      Uint8Array.from({ length: 32 }, () => 0x11),
      12,
    );
    bytes.set(
      Uint8Array.from({ length: 32 }, () => 0x22),
      44,
    );
    bytes.set(
      Uint8Array.from({ length: 32 }, () => 0x33),
      76,
    );
    new DataView(bytes.buffer).setUint32(108, 3, true);
    bytes.set([0xff, 0xfe, 0xfd], 112);

    const log = `Program data: ${Buffer.from(bytes).toString('base64url')}`;

    const [announcement] = parseAnnouncementLogs([log], context, 'logs');

    expect(announcement.metadata).toBe('fffefd');
  });

  test('decodes multiple events from one transaction', () => {
    const result = parseAnnouncementLogs(
      [announcementEvent(), 'Program log: unrelated', announcementEvent({ schemeId: 2 })],
      context,
      'logs',
    );

    expect(result.map((announcement) => announcement.schemeId)).toEqual([1, 2]);
  });

  test('skips unrelated and wrong-discriminator logs', () => {
    expect(
      parseAnnouncementLogs(
        ['Program log: hello', programData(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))],
        context,
        'logs',
      ),
    ).toEqual([]);
  });

  test.each([
    ['null logs', null, 'logs'],
    ['string logs', 'nope', 'logs'],
    ['non-string entry', [42], 'logs[0]'],
    ['too many logs', Array.from({ length: 1025 }, () => 'Program log: x'), 'logs'],
    ['oversized line', ['x'.repeat(16_385)], 'logs[0]'],
    ['invalid base64', ['Program data: %%%'], 'logs[0]'],
  ])('rejects %s', (_label, logs, field) => {
    const error = captureError(() => parseAnnouncementLogs(logs, context, 'logs'));

    expect(error).toBeInstanceOf(RPCResponseError);
    expect((error as RPCResponseError).field).toContain(field);
  });

  test('rejects a truncated announcement payload', () => {
    const truncated = programData(Uint8Array.from([...ANNOUNCEMENT_EVENT_DISCRIMINATOR, 1, 2, 3]));
    const error = captureError(() => parseAnnouncementLogs([truncated], context, 'logs'));

    expect(error).toBeInstanceOf(RPCResponseError);
    expect(error.message).toContain('truncated');
  });

  test('rejects metadata longer than the payload', () => {
    const log = announcementEvent({ metadata: Uint8Array.from([1]), metadataLength: 100 });
    const error = captureError(() => parseAnnouncementLogs([log], context, 'logs'));

    expect(error).toBeInstanceOf(RPCResponseError);
    expect(error.message).toContain('remaining');
  });

  test('rejects metadata above the size limit', () => {
    const log = announcementEvent({
      metadata: Uint8Array.from([1]),
      metadataLength: MAX_ANNOUNCEMENT_METADATA_BYTES + 1,
    });
    const error = captureError(() => parseAnnouncementLogs([log], context, 'logs'));

    expect(error).toBeInstanceOf(RPCResponseError);
    expect(error.message).toContain('exceeds');
  });
});

describe('parseSignaturePage', () => {
  test('accepts objects and bare signature strings', () => {
    const result = parseSignaturePage(
      [{ signature: 'sig-a' }, 'sig-b', { signature: 'sig-c', slot: 1 }],
      context,
    );

    expect(result).toEqual(['sig-a', 'sig-b', 'sig-c']);
  });

  test.each([
    ['null result', null, 'result'],
    ['object result', {}, 'result'],
    ['null entry', [null], 'result[0]'],
    ['missing signature', [{}], 'result[0].signature'],
    ['numeric signature', [{ signature: 42 }], 'result[0].signature'],
    ['empty signature', [{ signature: '' }], 'result[0].signature'],
    ['oversized signature', [{ signature: 'x'.repeat(129) }], 'result[0].signature'],
    ['too many entries', Array.from({ length: 1001 }, () => 'sig'), 'result'],
  ])('rejects %s', (_label, result, field) => {
    const error = captureError(() => parseSignaturePage(result, context));

    expect(error).toBeInstanceOf(RPCResponseError);
    expect((error as RPCResponseError).field).toContain(field);
  });
});

describe('parseTransactionLogs', () => {
  test('returns null for an unknown transaction or one without logs', () => {
    expect(parseTransactionLogs(null, context)).toBeNull();
    expect(parseTransactionLogs(undefined, context)).toBeNull();
    expect(parseTransactionLogs({ meta: null }, context)).toBeNull();
    expect(parseTransactionLogs({ meta: {} }, context)).toBeNull();
  });

  test('returns validated log messages', () => {
    expect(parseTransactionLogs({ meta: { logMessages: ['a', 'b'] } }, context)).toEqual([
      'a',
      'b',
    ]);
  });

  test.each([
    ['array transaction', [], 'result'],
    ['array meta', { meta: [] }, 'result.meta'],
    ['string logMessages', { meta: { logMessages: 'logs' } }, 'result.meta.logMessages'],
    ['numeric log entry', { meta: { logMessages: [1] } }, 'result.meta.logMessages[0]'],
    [
      'too many log entries',
      { meta: { logMessages: Array.from({ length: 1025 }, () => 'x') } },
      'result.meta.logMessages',
    ],
  ])('rejects %s', (_label, transaction, field) => {
    const error = captureError(() => parseTransactionLogs(transaction, context));

    expect(error).toBeInstanceOf(RPCResponseError);
    expect((error as RPCResponseError).field).toContain(field);
  });
});

describe('createBoundedSolanaFetch', () => {
  const boundedFetch = () => createBoundedSolanaFetch(context, 1024);

  test('passes a valid response through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ result: [] }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const response = await boundedFetch()('https://api.devnet.solana.com');

    await expect(response.json()).resolves.toEqual({ result: [] });
  });

  test('rejects a declared oversized body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{}', {
          headers: { 'content-length': '2048' },
        }),
      ),
    );

    const error = await boundedFetch()('https://api.devnet.solana.com').catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(RPCResponseError);
    expect((error as RPCResponseError).field).toBe('body');
  });

  test('rejects a streamed oversized body', async () => {
    const chunk = new Uint8Array(800).fill(0x20);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(chunk);
              controller.enqueue(chunk);
              controller.close();
            },
          }),
        ),
      ),
    );

    const error = await boundedFetch()('https://api.devnet.solana.com').catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(RPCResponseError);
    expect((error as RPCResponseError).field).toBe('body');
  });

  test('leaves non-2xx responses for the RPC client to handle', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })),
    );

    const response = await boundedFetch()('https://api.devnet.solana.com');

    expect(response.status).toBe(429);
  });
});

describe('Solana fetchAnnouncements resilience', () => {
  test('walks both programs and parses announcement logs', async () => {
    mocks.getSignatures.mockResolvedValueOnce([{ signature: SIG_A }]).mockResolvedValueOnce([]);
    mocks.getTransaction.mockResolvedValueOnce(TX_WITH_ANNOUNCEMENT);

    const result = await fetchAnnouncements('solana');

    expect(result).toHaveLength(1);
    expect(result[0]?.schemeId).toBe(1);
    expect(mocks.getSignatures).toHaveBeenCalledTimes(2);
  });

  test('times out an RPC call that never answers', async () => {
    mocks.getSignatures.mockReturnValue(new Promise(() => {}));

    await expect(
      fetchAnnouncements('solana', {
        timeouts: { requestMs: 25 },
        retry: { maxRetries: 0 },
      }),
    ).rejects.toBeInstanceOf(RPCTimeoutError);
  });

  test('rejects an already-aborted signal without calling the RPC', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchAnnouncements('solana', { signal: controller.signal }),
    ).rejects.toBeInstanceOf(RPCAbortedError);
    expect(mocks.getSignatures).not.toHaveBeenCalled();
  });

  test('aborts an in-flight RPC call', async () => {
    mocks.getSignatures.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();

    const promise = fetchAnnouncements('solana', { signal: controller.signal });
    const assertion = expect(promise).rejects.toBeInstanceOf(RPCAbortedError);
    controller.abort();
    await assertion;
  });

  test('retries rate-limited RPC calls with backoff', async () => {
    mocks.getSignatures
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await fetchAnnouncements('solana', {
      retry: { maxRetries: 1, baseDelayMs: 0 },
    });

    expect(result).toEqual([]);
    expect(mocks.getSignatures).toHaveBeenCalledTimes(3);
  });

  test('reports a non-retryable RPC failure as AnnouncementProviderError', async () => {
    mocks.getSignatures.mockRejectedValue(new Error('invalid account data'));

    await expect(fetchAnnouncements('solana')).rejects.toBeInstanceOf(AnnouncementProviderError);
  });

  test('rejects malformed cursors before calling the RPC', async () => {
    await expect(fetchAnnouncements('solana', { cursor: 'not-json' })).rejects.toMatchObject({
      name: 'AnnouncementCursorError',
      reason: 'malformed',
    } satisfies Partial<AnnouncementCursorError>);

    await expect(
      fetchAnnouncements('solana', { cursor: JSON.stringify({ v: 2, program: 0 }) }),
    ).rejects.toBeInstanceOf(AnnouncementCursorError);
    expect(mocks.getSignatures).not.toHaveBeenCalled();
  });

  test('stops at the maximum-page budget and keeps partial progress', async () => {
    mocks.getSignatures
      .mockResolvedValueOnce([{ signature: SIG_A }])
      .mockResolvedValueOnce([{ signature: SIG_B }]);
    mocks.getTransaction.mockResolvedValue(TX_WITH_ANNOUNCEMENT);

    const error = await fetchAnnouncements('solana', { pageSize: 1, maxPages: 2 }).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(AnnouncementBudgetExceededError);
    const budgetError = error as AnnouncementBudgetExceededError;
    expect(budgetError.budget).toBe('pages');
    expect(budgetError.fetched).toBe(2);
    expect(budgetError.partial).toHaveLength(2);
    expect(typeof budgetError.cursor).toBe('string');
    expect(mocks.getSignatures).toHaveBeenCalledTimes(2);
  });

  test('fetches one page and resumes from its signature cursor', async () => {
    mocks.getSignatures.mockResolvedValueOnce([{ signature: SIG_A }]);
    mocks.getTransaction.mockResolvedValueOnce(TX_WITH_ANNOUNCEMENT);

    const first = await fetchAnnouncementsPage('solana', { pageSize: 1 });

    expect(first.hasMore).toBe(true);
    expect(first.cursor).toBeDefined();

    mocks.getSignatures.mockResolvedValueOnce([]);
    const second = await fetchAnnouncementsPage('solana', {
      pageSize: 1,
      cursor: first.cursor,
    });

    const options = mocks.getSignatures.mock.calls[1]?.[1] as { before?: string };
    expect(options.before).toBe(SIG_A);
    expect(second.announcements).toEqual([]);
  });
});

describe('fetchAnnouncements (Solana response validation)', () => {
  test('validates and decodes announcements through the bounded connection', async () => {
    mocks.getSignatures.mockResolvedValueOnce([{ signature: SIG_A }]).mockResolvedValueOnce([]);
    mocks.getTransaction.mockResolvedValueOnce(TX_WITH_ANNOUNCEMENT);

    const result = await fetchAnnouncements();

    expect(result).toHaveLength(1);
    expect(result[0].schemeId).toBe(1);
    expect(mocks.constructed.mock.calls[0]?.[1]).toMatchObject({ fetch: expect.any(Function) });
  });

  test('skips transactions that are unavailable', async () => {
    mocks.getSignatures.mockResolvedValueOnce([{ signature: SIG_A }]).mockResolvedValueOnce([]);

    await expect(fetchAnnouncements()).resolves.toEqual([]);
  });

  test('surfaces a malformed signature page', async () => {
    mocks.getSignatures.mockResolvedValue([{ signature: 42 }]);

    const error = await fetchAnnouncements().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RPCResponseError);
    expect((error as RPCResponseError).operation).toBe('fetchAnnouncements');
  });

  test('surfaces a malformed announcement log', async () => {
    mocks.getSignatures.mockResolvedValueOnce([{ signature: SIG_A }]).mockResolvedValueOnce([]);
    mocks.getTransaction.mockResolvedValueOnce({
      meta: { logMessages: ['Program data: %%%'] },
    });

    const error = await fetchAnnouncements().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RPCResponseError);
    expect((error as RPCResponseError).field).toContain('logMessages');
  });
});

function captureError(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err;
  }
}
