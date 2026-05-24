import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  fetchAnnouncements,
  RetentionExceededError,
} from '../../../src/chains/stellar/announcements';

const sorobanUrl = 'https://soroban-testnet.stellar.org';
const horizonUrl = 'https://horizon-testnet.stellar.org';

type FetchCall = {
  url: string;
  body?: any;
};

const calls: FetchCall[] = [];

function jsonResponse(body: unknown) {
  return Promise.resolve({
    json: () => Promise.resolve(body),
  } as Response);
}

function mockFetch(handler: (url: string, body?: any) => unknown) {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = init?.body ? JSON.parse(init.body.toString()) : undefined;
      calls.push({ url, body });
      return jsonResponse(handler(url, body));
    }),
  );
}

function sorobanRange(oldest = 100, latest = 200) {
  return {
    error: {
      message: `startLedger outside retained range: ${oldest} - ${latest}`,
    },
  };
}

function emptyEvents(cursor = 'next-cursor') {
  return {
    result: {
      events: [],
      cursor,
    },
  };
}

function methodCalls(method: string) {
  return calls.filter((call) => call.body?.method === method);
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe('fetchAnnouncements Stellar ranges', () => {
  test('passes an explicit ledger range to Soroban getEvents', async () => {
    mockFetch((_url, body) => {
      if (body?.id === 0) return sorobanRange();
      return {
        result: {
          events: [...Array.from({ length: 999 }, () => ({ ledger: 174 })), { ledger: 175 }],
          cursor: 'range-cursor',
        },
      };
    });

    const result = await fetchAnnouncements('stellar', { fromLedger: 150, toLedger: 175 });
    const scan = methodCalls('getEvents')[1].body.params;

    expect(scan.startLedger).toBe(150);
    expect(scan.pagination).toEqual({ limit: 1000 });
    expect(result).toEqual({ announcements: [], nextCursor: 'range-cursor' });
    expect(methodCalls('getEvents')).toHaveLength(2);
  });

  test('uses cursor pagination instead of fromLedger when both are provided', async () => {
    mockFetch((_url, body) => {
      if (body?.id === 0) return sorobanRange();
      return emptyEvents('resume-cursor');
    });

    await fetchAnnouncements('stellar', { fromLedger: 150, cursor: 'previous-cursor' });
    const scan = methodCalls('getEvents')[1].body.params;

    expect(scan.startLedger).toBeUndefined();
    expect(scan.pagination).toEqual({ limit: 1000, cursor: 'previous-cursor' });
  });

  test('converts timestamps to inclusive and exclusive ledger bounds through Horizon', async () => {
    mockFetch((url, body) => {
      if (url === sorobanUrl && body?.id === 0) return sorobanRange(1, 8);
      if (url === `${horizonUrl}/ledgers?order=desc&limit=1`) {
        return { _embedded: { records: [{ sequence: 8, closed_at: '2026-01-01T00:08:00Z' }] } };
      }
      const sequence = Number(url.split('/').pop());
      return {
        sequence,
        closed_at: `2026-01-01T00:${sequence.toString().padStart(2, '0')}:00Z`,
      };
    });

    await fetchAnnouncements('stellar', {
      fromTimestamp: new Date('2026-01-01T00:04:00Z'),
      toTimestamp: new Date('2026-01-01T00:07:00Z'),
    });

    const scan = methodCalls('getEvents')[1].body.params;
    expect(scan.startLedger).toBe(4);
  });

  test('throws a typed error when requested fromLedger predates Soroban retention', async () => {
    mockFetch((_url, body) => {
      if (body?.id === 0) return sorobanRange(100, 200);
      return emptyEvents();
    });

    await expect(fetchAnnouncements('stellar', { fromLedger: 99 })).rejects.toMatchObject({
      name: 'RetentionExceededError',
      requestedLedger: 99,
      oldestAvailableLedger: 100,
    } satisfies Partial<RetentionExceededError>);
  });

  test('rejects ambiguous ledger and timestamp lower bounds', async () => {
    await expect(
      fetchAnnouncements('stellar', {
        fromLedger: 10,
        fromTimestamp: new Date('2026-01-01T00:00:00Z'),
      }),
    ).rejects.toThrow('fromLedger and fromTimestamp are mutually exclusive');
  });
});
