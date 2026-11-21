import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fetchAnnouncements } from '../../../src/chains/solana/announcements';
import { base58Encode } from '../../../src/chains/solana/utils';
import {
  createBoundedSolanaFetch,
  MAX_ANNOUNCEMENT_METADATA_BYTES,
  parseAnnouncementLogs,
  parseSignaturePage,
  parseTransactionLogs,
} from '../../../src/chains/solana/validation';
import { RPCResponseError } from '../../../src/errors';
import type { RPCResponseContext } from '../../../src/chains/rpcValidation';
import { ANNOUNCEMENT_EVENT_DISCRIMINATOR, announcementEvent, programData } from './fixtures/logs';

const context: RPCResponseContext = { chain: 'solana', operation: 'fetchAnnouncements' };

const solanaMock = vi.hoisted(() => ({
  signatures: [] as unknown[],
  transactions: new Map<string, unknown>(),
  connectionOptions: [] as unknown[],
}));

vi.mock('@solana/web3.js', () => ({
  PublicKey: class {
    readonly value: string;
    constructor(value: string) {
      this.value = value;
    }
    toBase58(): string {
      return this.value;
    }
  },
  Connection: class {
    constructor(_url: string, options: unknown) {
      solanaMock.connectionOptions.push(options);
    }
    async getSignaturesForAddress(): Promise<unknown[]> {
      return solanaMock.signatures;
    }
    async getTransaction(signature: string): Promise<unknown> {
      return solanaMock.transactions.get(signature) ?? null;
    }
  },
}));

beforeEach(() => {
  solanaMock.signatures = [];
  solanaMock.transactions.clear();
  solanaMock.connectionOptions = [];
});

afterEach(() => {
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

describe('fetchAnnouncements (Solana)', () => {
  test('validates and returns announcements from both programs', async () => {
    solanaMock.signatures = [{ signature: 'sig-1' }];
    solanaMock.transactions.set('sig-1', { meta: { logMessages: [announcementEvent()] } });

    const result = await fetchAnnouncements();

    expect(result).toHaveLength(2);
    expect(solanaMock.connectionOptions[0]).toMatchObject({ fetch: expect.any(Function) });
  });

  test('skips transactions that are unavailable', async () => {
    solanaMock.signatures = [{ signature: 'sig-1' }];

    await expect(fetchAnnouncements()).resolves.toEqual([]);
  });

  test('surfaces a malformed signature page', async () => {
    solanaMock.signatures = [{ signature: 42 }];

    const error = await fetchAnnouncements().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RPCResponseError);
    expect((error as RPCResponseError).operation).toBe('fetchAnnouncements');
  });

  test('surfaces a malformed announcement log', async () => {
    solanaMock.signatures = [{ signature: 'sig-1' }];
    solanaMock.transactions.set('sig-1', {
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
