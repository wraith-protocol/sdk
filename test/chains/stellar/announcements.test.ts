import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  fetchAnnouncements,
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

function makeEventsPage(count: number, cursor?: string) {
  const events = Array.from({ length: count }, (_, i) => ({
    topic: [`topic0_${i}`, `topic1_${i}`, `topic2_${i}`],
    value: `value_${i}`,
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

    fetchSpy = mockFetchSequence([makeProbeSuccess(), makeEventsPage(3)]);
    vi.stubGlobal('fetch', fetchSpy);

    const results = await collectStream(fetchAnnouncementsStream());
    expect(results.length).toBe(3);
    expect(results[0]).toMatchObject({ schemeId: 1 });
  });

  test('follows cursor across multiple pages', async () => {
    const { fetchAnnouncementsStream } = await import('../../../src/chains/stellar/announcements');

    fetchSpy = mockFetchSequence([
      makeProbeSuccess(),
      makeEventsPage(1000, 'cursor-abc'),
      makeEventsPage(5),
    ]);
    vi.stubGlobal('fetch', fetchSpy);

    const results = await collectStream(fetchAnnouncementsStream());
    expect(results.length).toBe(1005);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const secondPageBody = JSON.parse(fetchSpy.mock.calls[2][1].body);
    expect(secondPageBody.params.pagination.cursor).toBe('cursor-abc');
  });

  test('adjusts startLedger from probe range error', async () => {
    const { fetchAnnouncementsStream } = await import('../../../src/chains/stellar/announcements');

    fetchSpy = mockFetchSequence([makeProbeRangeError(1000, 6500), makeEventsPage(2)]);
    vi.stubGlobal('fetch', fetchSpy);

    const results = await collectStream(fetchAnnouncementsStream());
    expect(results.length).toBe(2);

    const pageBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
    expect(pageBody.params.startLedger).toBe(1500); // max(1000, 6500-5000)
  });

  test('returns empty stream on unrecoverable probe error', async () => {
    const { fetchAnnouncementsStream } = await import('../../../src/chains/stellar/announcements');

    fetchSpy = mockFetchSequence([makeProbeUnknownError()]);
    vi.stubGlobal('fetch', fetchSpy);

    const results = await collectStream(fetchAnnouncementsStream());
    expect(results).toHaveLength(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test('stops when page has fewer than 1000 events and no cursor', async () => {
    const { fetchAnnouncementsStream } = await import('../../../src/chains/stellar/announcements');

    fetchSpy = mockFetchSequence([makeProbeSuccess(), makeEventsPage(500)]);
    vi.stubGlobal('fetch', fetchSpy);

    await collectStream(fetchAnnouncementsStream());
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test('uses sorobanUrl override', async () => {
    const { fetchAnnouncementsStream } = await import('../../../src/chains/stellar/announcements');

    const customUrl = 'https://custom-rpc.example.com';
    fetchSpy = mockFetchSequence([makeProbeSuccess(), makeEventsPage(1)]);
    vi.stubGlobal('fetch', fetchSpy);

    await collectStream(fetchAnnouncementsStream('stellar', customUrl));
    expect(fetchSpy.mock.calls[0][0]).toBe(customUrl);
  });

  test('cancellation: stops after yielding first item', async () => {
    const { fetchAnnouncementsStream } = await import('../../../src/chains/stellar/announcements');

    fetchSpy = mockFetchSequence([makeProbeSuccess(), makeEventsPage(1000, 'cursor-next')]);
    vi.stubGlobal('fetch', fetchSpy);

    const results: Announcement[] = [];
    for await (const ann of fetchAnnouncementsStream()) {
      results.push(ann);
      break;
    }

    expect(results).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // probe + first page only
  });
});

// ---------------------------------------------------------------------------
// fetchAnnouncements (simple array wrapper)
// ---------------------------------------------------------------------------

describe('fetchAnnouncements (wrapper)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test('returns all announcements as array', async () => {
    const { fetchAnnouncements: fetchAll } =
      await import('../../../src/chains/stellar/announcements');

    vi.stubGlobal('fetch', mockFetchSequence([makeProbeSuccess(), makeEventsPage(7)]));

    const results = await fetchAll();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(7);
  });
});
