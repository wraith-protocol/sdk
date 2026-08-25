import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  fetchAnnouncementsStream,
  RetentionExceededError,
} from '../../../src/chains/stellar/announcements';
import type { Announcement } from '../../../src/chains/stellar/types';

vi.mock('@stellar/stellar-sdk', () => {
  const mockAddress = {
    toString: () => 'GMOCKADDRESS000000000000000000000000000000000000000000000',
  };
  const makeScVal = (overrides: Record<string, unknown> = {}) => ({
    u32: () => 1,
    address: () => ({}),
    vec: () => [
      { address: () => ({}) },
      { bytes: () => new Uint8Array(32).fill(1) },
      { bytes: () => new Uint8Array(1).fill(0x42) },
    ],
    ...overrides,
  });

  return {
    xdr: {
      ScVal: {
        fromXDR: vi.fn((_data: string, _enc: string) => makeScVal()),
        scvSymbol: vi.fn((sym: string) => ({ toXDR: vi.fn(() => `sym:${sym}`) })),
        scvU32: vi.fn((n: number) => ({ toXDR: vi.fn(() => `u32:${n}`) })),
        scvBytes: vi.fn((bytes: Buffer) => ({ toXDR: vi.fn(() => bytes.toString('hex')) })),
        scvVec: vi.fn((vec: unknown[]) => ({ toXDR: vi.fn(() => JSON.stringify(vec)) })),
      },
    },
    Address: {
      fromScAddress: vi.fn(() => mockAddress),
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers shared by HEAD-style tests (fetchAnnouncements with options)
// ---------------------------------------------------------------------------

type FetchCall = { url: string; body?: any };
const calls: FetchCall[] = [];

function jsonResponse(body: unknown) {
  return Promise.resolve({ json: () => Promise.resolve(body) } as Response);
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

// ---------------------------------------------------------------------------
// Helpers for streaming tests (fetchAnnouncementsStream)
// ---------------------------------------------------------------------------

function makeProbeSuccess() {
  return { result: { events: [{ topic: ['', '', ''], value: '' }] } };
}

function makeProbeRangeError(oldest: number, latest: number) {
  return { error: { message: `range: ${oldest} - ${latest}` } };
}

function makeProbeUnknownError() {
  return { error: { message: 'some unknown error' } };
}

function makeEventsPage(count: number, cursor?: string, startIdx = 0) {
  const events = Array.from({ length: count }, (_, i) => ({
    id: `event-${startIdx + i}`,
    topic: [`topic0_${startIdx + i}`, `topic1_${startIdx + i}`, `topic2_${startIdx + i}`],
    value: `value_${startIdx + i}`,
  }));
  return { result: { events, cursor } };
}

function mockFetchSequence(responses: unknown[]) {
  let call = 0;
  return vi.fn(async () => {
    const body = responses[call++] ?? responses[responses.length - 1];
    return { json: async () => body } as Response;
  });
}

async function collectStream(gen: AsyncGenerator<Announcement>): Promise<Announcement[]> {
  const out: Announcement[] = [];
  for await (const a of gen) out.push(a);
  return out;
}

// ---------------------------------------------------------------------------
// fetchAnnouncements with FetchAnnouncementsOptions (ledger ranges, cursors, timestamps)
// ---------------------------------------------------------------------------

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

    const result = await collectStream(
      fetchAnnouncementsStream('stellar', { fromLedger: 150, toLedger: 175 }),
    );
    const scan = methodCalls('getEvents')[1].body.params;

    expect(scan.startLedger).toBe(150);
    expect(scan.pagination).toEqual({ limit: 1000 });
    expect(result).toEqual([]);
    expect(methodCalls('getEvents')).toHaveLength(2);
  });

  test('uses cursor pagination instead of fromLedger when both are provided', async () => {
    mockFetch((_url, body) => {
      if (body?.id === 0) return sorobanRange();
      return emptyEvents('resume-cursor');
    });

    await collectStream(
      fetchAnnouncementsStream('stellar', { fromLedger: 150, cursor: 'previous-cursor' }),
    );
    const scan = methodCalls('getEvents')[1].body.params;

    expect(scan.startLedger).toBeUndefined();
    expect(scan.pagination).toEqual({ limit: 1000, cursor: 'previous-cursor' });
  });

  test('converts timestamps to inclusive and exclusive ledger bounds through Horizon', async () => {
    const sorobanUrl = 'https://soroban-testnet.stellar.org';
    const horizonUrl = 'https://horizon-testnet.stellar.org';

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

    await collectStream(
      fetchAnnouncementsStream('stellar', {
        fromTimestamp: new Date('2026-01-01T00:04:00Z'),
        toTimestamp: new Date('2026-01-01T00:07:00Z'),
      }),
    );

    const scan = methodCalls('getEvents')[1].body.params;
    expect(scan.startLedger).toBe(4);
  });

  test('throws a typed error when requested fromLedger predates Soroban retention', async () => {
    mockFetch((_url, body) => {
      if (body?.id === 0) return sorobanRange(100, 200);
      return emptyEvents();
    });

    await expect(
      (async () => {
        for await (const _ of fetchAnnouncementsStream('stellar', { fromLedger: 99 })) {
        }
      })(),
    ).rejects.toMatchObject({
      name: 'RetentionExceededError',
      requestedLedger: 99,
      oldestAvailableLedger: 100,
    } satisfies Partial<RetentionExceededError>);
  });

  test('rejects ambiguous ledger and timestamp lower bounds', async () => {
    await expect(
      (async () => {
        for await (const _ of fetchAnnouncementsStream('stellar', {
          fromLedger: 10,
          fromTimestamp: new Date('2026-01-01T00:00:00Z'),
        })) {
        }
      })(),
    ).rejects.toThrow('fromLedger and fromTimestamp are mutually exclusive');
  });
});

// ---------------------------------------------------------------------------
// fetchAnnouncementsStream (streaming generator)
// ---------------------------------------------------------------------------

describe('fetchAnnouncementsStream', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = mockFetchSequence([]);
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('yields announcements from a single page', async () => {
    const { fetchAnnouncementsStream } = await import('../../../src/chains/stellar/announcements');

    fetchSpy = mockFetchSequence([
      makeProbeSuccess(),
      { result: { sequence: 100 } },
      makeEventsPage(3),
    ]);
    vi.stubGlobal('fetch', fetchSpy);

    const results = await collectStream(fetchAnnouncementsStream('stellar', { includeV2: false }));
    expect(results.length).toBe(3);
    expect(results[0]).toMatchObject({ schemeId: 1 });
  });

  test('follows cursor across multiple pages', async () => {
    const { fetchAnnouncementsStream } = await import('../../../src/chains/stellar/announcements');

    fetchSpy = mockFetchSequence([
      makeProbeSuccess(),
      { result: { sequence: 100 } },
      makeEventsPage(1000, 'cursor-abc', 0),
      makeEventsPage(5, undefined, 1000),
    ]);
    vi.stubGlobal('fetch', fetchSpy);

    const results = await collectStream(fetchAnnouncementsStream('stellar', { includeV2: false }));
    expect(results.length).toBe(1005);
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    const secondPageBody = JSON.parse(fetchSpy.mock.calls[3][1].body);
    expect(secondPageBody.params.pagination.cursor).toBe('cursor-abc');
  });

  test('adjusts startLedger from probe range error', async () => {
    const { fetchAnnouncementsStream } = await import('../../../src/chains/stellar/announcements');

    fetchSpy = mockFetchSequence([makeProbeRangeError(1000, 6500), makeEventsPage(2)]);
    vi.stubGlobal('fetch', fetchSpy);

    const results = await collectStream(fetchAnnouncementsStream('stellar', { includeV2: false }));
    expect(results.length).toBe(2);

    const pageBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
    expect(pageBody.params.startLedger).toBe(1500); // max(1000, 6500-5000)
  });

  test('returns empty stream on unrecoverable probe error', async () => {
    const { fetchAnnouncementsStream } = await import('../../../src/chains/stellar/announcements');

    fetchSpy = mockFetchSequence([
      makeProbeUnknownError(),
      { result: { sequence: 100 } },
      emptyEvents(),
    ]);
    vi.stubGlobal('fetch', fetchSpy);

    const results = await collectStream(fetchAnnouncementsStream('stellar', { includeV2: false }));
    expect(results).toHaveLength(0);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  test('stops when page has fewer than 1000 events and no cursor', async () => {
    const { fetchAnnouncementsStream } = await import('../../../src/chains/stellar/announcements');

    fetchSpy = mockFetchSequence([
      makeProbeSuccess(),
      { result: { sequence: 100 } },
      makeEventsPage(500),
    ]);
    vi.stubGlobal('fetch', fetchSpy);

    await collectStream(fetchAnnouncementsStream('stellar', { includeV2: false }));
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  test('uses sorobanUrl override', async () => {
    const { fetchAnnouncementsStream } = await import('../../../src/chains/stellar/announcements');

    const customUrl = 'https://custom-rpc.example.com';
    fetchSpy = mockFetchSequence([
      makeProbeSuccess(),
      { result: { sequence: 100 } },
      makeEventsPage(1),
    ]);
    vi.stubGlobal('fetch', fetchSpy);

    await collectStream(
      fetchAnnouncementsStream('stellar', { sorobanUrl: customUrl, includeV2: false }),
    );
    expect(fetchSpy.mock.calls[0][0]).toBe(customUrl);
  });

  test('cancellation: stops after yielding first item', async () => {
    const { fetchAnnouncementsStream } = await import('../../../src/chains/stellar/announcements');

    fetchSpy = mockFetchSequence([
      makeProbeSuccess(),
      { result: { sequence: 100 } },
      makeEventsPage(1000, 'cursor-next'),
    ]);
    vi.stubGlobal('fetch', fetchSpy);

    const results: Announcement[] = [];
    for await (const ann of fetchAnnouncementsStream('stellar', { includeV2: false })) {
      results.push(ann);
      break;
    }

    expect(results).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(3); // first page only
  });
});

// ---------------------------------------------------------------------------
// Property tests for parallel chunking and ordered merge
// ---------------------------------------------------------------------------

describe('parallel chunking ordering guarantee', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
  });

  test('mergeOrdered yields items in ascending key order regardless of completion order', async () => {
    // Create async iterables that complete in different orders
    const iterables: Array<AsyncIterable<{ item: number; key: number }>> = [
      (async function* () {
        await sleep(30); // completes last
        yield { item: 1, key: 1 };
        yield { item: 2, key: 2 };
      })(),
      (async function* () {
        await sleep(10); // completes first
        yield { item: 5, key: 5 };
        yield { item: 6, key: 6 };
      })(),
      (async function* () {
        await sleep(20); // completes middle
        yield { item: 3, key: 3 };
        yield { item: 4, key: 4 };
      })(),
    ];

    // Import the internal mergeOrdered function
    const { mergeOrdered } = await import('../../../src/chains/stellar/announcements');

    const results: number[] = [];
    for await (const item of mergeOrdered(iterables)) {
      results.push(item);
    }

    // Should be in ascending key order: 1, 2, 3, 4, 5, 6
    expect(results).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('mergeOrdered handles empty iterables', async () => {
    const iterables: Array<AsyncIterable<{ item: number; key: number }>> = [
      (async function* () {
        yield { item: 1, key: 1 };
      })(),
      (async function* () {
        // empty
      })(),
      (async function* () {
        yield { item: 2, key: 2 };
      })(),
    ];

    const { mergeOrdered } = await import('../../../src/chains/stellar/announcements');

    const results: number[] = [];
    for await (const item of mergeOrdered(iterables)) {
      results.push(item);
    }

    expect(results).toEqual([1, 2]);
  });

  test('mergeOrdered handles duplicate keys', async () => {
    const iterables: Array<AsyncIterable<{ item: number; key: number }>> = [
      (async function* () {
        yield { item: 1, key: 1 };
        yield { item: 2, key: 2 };
      })(),
      (async function* () {
        yield { item: 3, key: 2 }; // duplicate key
        yield { item: 4, key: 3 };
      })(),
    ];

    const { mergeOrdered } = await import('../../../src/chains/stellar/announcements');

    const results: number[] = [];
    for await (const item of mergeOrdered(iterables)) {
      results.push(item);
    }

    // Should maintain stable sort for duplicates
    expect(results).toEqual([1, 2, 3, 4]);
  });

  test('splitRange divides ledger range into contiguous chunks', async () => {
    const { splitRange } = await import('../../../src/chains/stellar/announcements');

    const chunks = splitRange(100, 400, 3);
    expect(chunks).toEqual([
      { startLedger: 100, endLedger: 200 },
      { startLedger: 200, endLedger: 300 },
      { startLedger: 300, endLedger: 400 },
    ]);
  });

  test('splitRange handles single chunk', async () => {
    const { splitRange } = await import('../../../src/chains/stellar/announcements');

    const chunks = splitRange(100, 400, 1);
    expect(chunks).toEqual([{ startLedger: 100, endLedger: 400 }]);
  });

  test('splitRange handles non-even division', async () => {
    const { splitRange } = await import('../../../src/chains/stellar/announcements');

    const chunks = splitRange(100, 500, 3);
    expect(chunks).toEqual([
      { startLedger: 100, endLedger: 233 },
      { startLedger: 233, endLedger: 366 },
      { startLedger: 366, endLedger: 500 },
    ]);
  });

  test('default parallelism=1 behavior matches sequential path', async () => {
    fetchSpy = mockFetchSequence([
      makeProbeSuccess(),
      { result: { sequence: 100 } },
      makeEventsPage(3),
    ]);
    vi.stubGlobal('fetch', fetchSpy);

    const results1 = await collectStream(
      fetchAnnouncementsStream('stellar', { fromLedger: 150, toLedger: 175, includeV2: false }),
    );

    // Reset and test with explicit parallelism=1
    vi.clearAllMocks();
    fetchSpy = mockFetchSequence([
      makeProbeSuccess(),
      { result: { sequence: 100 } },
      makeEventsPage(3),
    ]);
    vi.stubGlobal('fetch', fetchSpy);

    const results2 = await collectStream(
      fetchAnnouncementsStream('stellar', {
        fromLedger: 150,
        toLedger: 175,
        parallelism: 1,
        includeV2: false,
      }),
    );

    // Both should produce identical results
    expect(results1).toEqual(results2);
    expect(results1.length).toBe(3);
  });

  test('parallelism is ignored when cursor is provided', async () => {
    fetchSpy = mockFetchSequence([
      makeProbeSuccess(),
      { result: { sequence: 100 } },
      emptyEvents('resume-cursor'),
    ]);
    vi.stubGlobal('fetch', fetchSpy);

    // Even with parallelism=4, cursor should force sequential path
    await collectStream(
      fetchAnnouncementsStream('stellar', {
        cursor: 'previous-cursor',
        parallelism: 4,
        includeV2: false,
      }),
    );

    const scan = JSON.parse(fetchSpy.mock.calls[2][1].body).params;

    // Should use cursor pagination, not parallel chunking
    expect(scan.startLedger).toBeUndefined();
    expect(scan.pagination).toEqual({ limit: 1000, cursor: 'previous-cursor' });
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
