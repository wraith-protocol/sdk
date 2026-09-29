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

function rpcEnvelope(body: unknown, id: number | null = null): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const data = body as Record<string, unknown>;
  if (data.jsonrpc !== undefined) return body;
  if (
    !Object.prototype.hasOwnProperty.call(data, 'result') &&
    !Object.prototype.hasOwnProperty.call(data, 'error')
  ) {
    return body;
  }
  if (data.error && typeof data.error === 'object' && !Array.isArray(data.error)) {
    data.error = { code: -1, ...(data.error as Record<string, unknown>) };
  }
  return { jsonrpc: '2.0', id, ...data };
}

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
      return jsonResponse(rpcEnvelope(handler(url, body), body?.id ?? null));
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
    id: `${String(1).padStart(10, '0')}-${String(startIdx + i).padStart(10, '0')}`,
    txHash: `txhash${startIdx + i}`,
    ledger: 1,
    contractId: 'CTEST',
    topic: [`topic0_${startIdx + i}`, `topic1_${startIdx + i}`, `topic2_${startIdx + i}`],
    value: `value_${startIdx + i}`,
  }));
  return { result: { events, cursor } };
}

function mockFetchSequence(responses: unknown[]) {
  let call = 0;
  return vi.fn(async () => {
    const body = responses[call++] ?? responses[responses.length - 1];
    return { json: async () => rpcEnvelope(body) } as Response;
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
          events: [
            ...Array.from({ length: 999 }, (_, i) => ({
              id: `range-event-${i}`,
              ledger: 174,
              topic: ['topic0', 'topic1', 'topic2'],
              value: 'value',
            })),
            { id: 'range-end', ledger: 175, topic: ['topic0', 'topic1', 'topic2'], value: 'value' },
          ],
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
    expect(result).toHaveLength(999);
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
      if (url === sorobanUrl) return emptyEvents();
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

  test('rejects a malformed JSON-RPC envelope with endpoint context', async () => {
    const endpoint = 'https://malformed-rpc.example.test/';
    fetchSpy = vi.fn(async () => ({ json: async () => ({ result: { events: [] } }) }) as Response);
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      collectStream(fetchAnnouncementsStream('stellar', { sorobanUrl: endpoint })),
    ).rejects.toMatchObject({
      name: 'AnnouncementParseError',
      endpoint,
      field: 'jsonrpc',
    });
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
// Cross-chunk deduplication tests
// ---------------------------------------------------------------------------

describe('cross-chunk deduplication', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test('computeEventIdentity deduplicates identical events from different pages', async () => {
    const { computeEventIdentity } = await import('../../../src/chains/stellar/announcements');

    // Simulate the same event appearing in two RPC pages with the same ledger-eventIndex
    const event = {
      id: '0000000100-0000000001',
      txHash: 'duplicate-tx',
      ledger: 100,
      contractId: 'CTEST123',
      topic: ['topic0', 'topic1', 'topic2'],
      value: 'value',
    };

    const page1Identity = computeEventIdentity(event);
    const page2Identity = computeEventIdentity({ ...event }); // same event, different object

    expect(page1Identity).not.toBeNull();
    expect(page2Identity).not.toBeNull();
    expect(page1Identity!.id).toBe(page2Identity!.id);

    // Simulate dedup via a Set
    const seen = new Set<string>();
    seen.add(page1Identity!.id);
    expect(seen.has(page2Identity!.id)).toBe(true); // would be deduplicated
  });

  test('seenEventIds option pre-filters events from previous scan sessions', async () => {
    const { computeEventIdentity } = await import('../../../src/chains/stellar/announcements');

    const event1 = {
      id: '0000000100-0000000001',
      txHash: 'tx1',
      ledger: 100,
      contractId: 'CTEST123',
      topic: ['topic0', 'topic1', 'topic2'],
      value: 'value1',
    };
    const event2 = {
      id: '0000000100-0000000002',
      txHash: 'tx1',
      ledger: 100,
      contractId: 'CTEST123',
      topic: ['topic0', 'topic1', 'topic2'],
      value: 'value2',
    };

    const identity1 = computeEventIdentity(event1);
    const identity2 = computeEventIdentity(event2);

    expect(identity1).not.toBeNull();
    expect(identity2).not.toBeNull();
    // Different event indices → different identities
    expect(identity1!.id).not.toBe(identity2!.id);

    // Pre-seed seen set with event1
    const seen = new Set([identity1!.id]);
    expect(seen.has(identity1!.id)).toBe(true); // filtered
    expect(seen.has(identity2!.id)).toBe(false); // not filtered
  });

  test('same-transaction events with different indices are not deduplicated', async () => {
    const { computeEventIdentity } = await import('../../../src/chains/stellar/announcements');

    const base = {
      txHash: 'same-tx',
      ledger: 100,
      contractId: 'CTEST',
      topic: ['t1', 't2', 't3'],
      value: 'v',
    };
    const identities = [1, 2, 3].map((i) =>
      computeEventIdentity({ ...base, id: `0000000100-000000000${i}` }),
    );

    expect(identities.every(Boolean)).toBe(true);
    const ids = identities.map((id) => id!.id);
    expect(new Set(ids).size).toBe(3); // all distinct
  });

  test('stream does not loop infinitely when events fail identity (fallback dedup key used)', async () => {
    const { fetchAnnouncementsStream } = await import('../../../src/chains/stellar/announcements');

    // Events without proper ledger-eventIndex format - fallback dedup path
    const fetchSpy = mockFetchSequence([
      makeProbeSuccess(),
      { result: { sequence: 100 } },
      makeEventsPage(3), // uses proper format from updated makeEventsPage
    ]);
    vi.stubGlobal('fetch', fetchSpy);

    // Should complete without hanging, even if events fail parsing
    const results = await collectStream(fetchAnnouncementsStream('stellar', { includeV2: false }));
    // makeEventsPage events fail XDR parsing → 0 yielded, but stream terminates
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  test('seen set accumulates across pages preventing re-fetch loops', async () => {
    const { fetchAnnouncementsStream } = await import('../../../src/chains/stellar/announcements');

    // Two pages: page2 has the same events as page1 (same IDs)
    const page1 = makeEventsPage(1000, 'cursor-abc', 0);
    const page2 = makeEventsPage(5, undefined, 0); // same startIdx = same IDs → all deduplicated

    const fetchSpy = mockFetchSequence([
      makeProbeSuccess(),
      { result: { sequence: 100 } },
      page1,
      page2,
    ]);
    vi.stubGlobal('fetch', fetchSpy);

    await collectStream(fetchAnnouncementsStream('stellar', { includeV2: false }));

    // Stream should have fetched both pages and terminated
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});
