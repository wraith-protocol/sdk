import { describe, test, expect } from 'vitest';
import { scanAll, UNKNOWN_TIMESTAMP } from '../../src/scanner/unified';
import type {
  ChainScannerAdapter,
  MatchedAnnouncement,
  ScanAllInput,
} from '../../src/scanner/unified';

/** Announcement shape for the fake third-party chain used throughout this file. */
interface FakeItem {
  id: string;
  at?: unknown;
}

async function* streamOf(items: FakeItem[]): AsyncIterable<FakeItem> {
  for (const item of items) yield item;
}

/**
 * Builds a custom adapter. `timestampOf` is attached only when supplied so the
 * omitted case exercises the genuine "adapter predates the contract" path
 * rather than an adapter that returns undefined.
 */
function makeAdapter(
  id: string,
  timestampOf?: (matched: FakeItem) => number | undefined,
): ChainScannerAdapter<FakeItem, unknown, FakeItem, unknown> {
  const adapter: ChainScannerAdapter<FakeItem, unknown, FakeItem, unknown> = {
    id,
    async *scan(source: AsyncIterable<FakeItem>) {
      for await (const item of source) yield item;
    },
    decodeMetaAddress: () => ({}),
    encodeMetaAddress: () => '',
  };
  if (timestampOf) adapter.timestampOf = timestampOf;
  return adapter;
}

async function collect(input: ScanAllInput): Promise<MatchedAnnouncement[]> {
  const out: MatchedAnnouncement[] = [];
  for await (const match of scanAll(input)) out.push(match);
  return out;
}

describe('custom adapter timestamps', () => {
  test('timestampOf values reach the matched announcement in source order', async () => {
    const items: FakeItem[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const times: Record<string, number> = { a: 1_700_000_100, b: 1_700_000_200, c: 1_700_000_300 };
    const adapter = makeAdapter('fake', (m) => times[m.id]);

    const results = await collect({
      adapters: [{ adapter, source: streamOf(items), keys: {} }],
    });

    expect(results.map((r) => r.chain)).toEqual(['fake', 'fake', 'fake']);
    expect(results.map((r) => (r.announcement as FakeItem).id)).toEqual(['a', 'b', 'c']);
    expect(results.map((r) => r.timestamp)).toEqual([1_700_000_100, 1_700_000_200, 1_700_000_300]);
    // seq is the per-chain arrival counter and must stay monotonic alongside it.
    expect(results.map((r) => r.seq)).toEqual([0, 1, 2]);
  });

  test('a timestamp field on the matched value is used when timestampOf is absent', async () => {
    const adapter = makeAdapter('field-only');
    const results = await collect({
      adapters: [
        {
          adapter,
          source: streamOf([
            { id: 'a', at: 0 },
            { id: 'b', at: 0 },
          ] as FakeItem[]),
          keys: {},
        },
      ],
    });
    // The fake items above carry no `timestamp`, so this is the fallback case.
    expect(results.map((r) => r.timestamp)).toEqual([UNKNOWN_TIMESTAMP, UNKNOWN_TIMESTAMP]);

    const withField = makeAdapter('field');
    const fielded = await collect({
      adapters: [
        {
          adapter: withField,
          source: streamOf([
            { id: 'a', timestamp: 42 } as unknown as FakeItem,
            { id: 'b', timestamp: 43 } as unknown as FakeItem,
          ]),
          keys: {},
        },
      ],
    });
    expect(fielded.map((r) => r.timestamp)).toEqual([42, 43]);
  });

  test('timestampOf wins over a timestamp field on the value', async () => {
    const adapter = makeAdapter('both', () => 999);
    const results = await collect({
      adapters: [
        {
          adapter,
          source: streamOf([{ id: 'a', timestamp: 1 } as unknown as FakeItem]),
          keys: {},
        },
      ],
    });
    expect(results[0].timestamp).toBe(999);
  });

  test('an adapter with no timestamp support still scans, reporting UNKNOWN_TIMESTAMP', async () => {
    const adapter = makeAdapter('legacy');
    const results = await collect({
      adapters: [{ adapter, source: streamOf([{ id: 'a' }, { id: 'b' }]), keys: {} }],
    });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.timestamp === UNKNOWN_TIMESTAMP)).toBe(true);
  });

  test.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative', -1],
    ['a string', '1700000000' as unknown as number],
    ['null', null as unknown as number],
  ])('a %s timestamp degrades to UNKNOWN_TIMESTAMP instead of propagating', async (_label, bad) => {
    const adapter = makeAdapter('bad', () => bad);
    const results = await collect({
      adapters: [{ adapter, source: streamOf([{ id: 'a' }]), keys: {} }],
    });
    expect(results[0].timestamp).toBe(UNKNOWN_TIMESTAMP);
    expect(Number.isFinite(results[0].timestamp)).toBe(true);
  });

  test('a throwing timestampOf does not abort the scan', async () => {
    const adapter = makeAdapter('throws', () => {
      throw new Error('adapter blew up');
    });
    const results = await collect({
      adapters: [{ adapter, source: streamOf([{ id: 'a' }, { id: 'b' }]), keys: {} }],
    });
    expect(results.map((r) => (r.announcement as FakeItem).id)).toEqual(['a', 'b']);
    expect(results.map((r) => r.timestamp)).toEqual([UNKNOWN_TIMESTAMP, UNKNOWN_TIMESTAMP]);
  });

  test('two custom chains keep their own timestamps and their own seq counters', async () => {
    const left = makeAdapter('left', (m) => Number(m.id) * 10);
    const right = makeAdapter('right', (m) => Number(m.id) * 100);

    const results = await collect({
      adapters: [
        { adapter: left, source: streamOf([{ id: '1' }, { id: '2' }]), keys: {} },
        { adapter: right, source: streamOf([{ id: '1' }, { id: '2' }]), keys: {} },
      ],
    });

    const byChain = (chain: string) => results.filter((r) => r.chain === chain);
    expect(byChain('left').map((r) => r.timestamp)).toEqual([10, 20]);
    expect(byChain('right').map((r) => r.timestamp)).toEqual([100, 200]);
    expect(byChain('left').map((r) => r.seq)).toEqual([0, 1]);
    expect(byChain('right').map((r) => r.seq)).toEqual([0, 1]);
  });
});
