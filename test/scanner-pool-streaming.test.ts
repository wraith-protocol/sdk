import { describe, it, expect } from 'vitest';
import {
  MultichainScannerPool,
  type ProgressEvent,
  type EvmScanInput,
  type SolanaScanInput,
} from '../src/scanner-pool';
import { ScanBudgetExceededError } from '../src/errors';
import type { Announcement as EvmAnnouncement } from '../src/chains/evm/types';
import type { Announcement as SolanaAnnouncement } from '../src/chains/solana/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const evmKeys = {
  viewingKey: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as const,
  spendingPubKey: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' as const,
  spendingKey: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as const,
};

const solanaKeys = {
  viewingKey: new Uint8Array(32).fill(0xcc),
  spendingPubKey: new Uint8Array(32).fill(0xdd),
  spendingScalar: 123456789n,
};

/** Wrong scheme id: scanning skips it without doing any crypto. */
function evmItem(): EvmAnnouncement {
  return { schemeId: 0n } as unknown as EvmAnnouncement;
}

function solanaItem(): SolanaAnnouncement {
  return { schemeId: 0 } as unknown as SolanaAnnouncement;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface TrackedSource<T> {
  source: AsyncIterable<T>;
  stats: {
    pulls: number;
    inFlight: number;
    peakInFlight: number;
    returned: boolean;
  };
}

/**
 * Async iterable that records how many pulls the pool issues concurrently and
 * whether it was closed through `return()`.
 */
function trackedSource<T>(
  item: () => T,
  options: { count?: number; latencyMs?: number } = {},
): TrackedSource<T> {
  const count = options.count ?? Number.POSITIVE_INFINITY;
  const stats = { pulls: 0, inFlight: 0, peakInFlight: 0, returned: false };

  const source: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      let produced = 0;
      return {
        next: async (): Promise<IteratorResult<T>> => {
          stats.pulls++;
          stats.inFlight++;
          stats.peakInFlight = Math.max(stats.peakInFlight, stats.inFlight);
          try {
            if (options.latencyMs) await delay(options.latencyMs);
            if (produced >= count) return { done: true, value: undefined };
            produced++;
            return { done: false, value: item() };
          } finally {
            stats.inFlight--;
          }
        },
        return: async (): Promise<IteratorResult<T>> => {
          stats.returned = true;
          return { done: true, value: undefined };
        },
      };
    },
  };

  return { source, stats };
}

function collectEvents(pool: MultichainScannerPool): ProgressEvent[] {
  const events: ProgressEvent[] = [];
  pool.on('progress', (e) => events.push({ ...e }));
  return events;
}

const evmStreamInput = (source: AsyncIterable<EvmAnnouncement>, overrides = {}): EvmScanInput => ({
  source,
  ...evmKeys,
  ...overrides,
});

const solanaStreamInput = (
  source: AsyncIterable<SolanaAnnouncement>,
  overrides = {},
): SolanaScanInput => ({
  source,
  ...solanaKeys,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Streaming inputs
// ---------------------------------------------------------------------------

describe('MultichainScannerPool – streaming inputs', () => {
  it('scans an async iterable without materializing it', async () => {
    const pool = new MultichainScannerPool({ chains: ['evm'] });
    const events = collectEvents(pool);
    const tracked = trackedSource(evmItem, { count: 500 });

    const results = await pool.scanAll({ evm: evmStreamInput(tracked.source) });

    expect(results.evm).toEqual([]);
    expect(tracked.stats.returned).toBe(true);
    const final = events[events.length - 1];
    expect(final).toMatchObject({
      chain: 'evm',
      processed: 500,
      streaming: true,
      buffered: 0,
    });
    expect(final.requests).toBeGreaterThanOrEqual(500);
  });

  it('reports streaming progress in bounded increments', async () => {
    const pool = new MultichainScannerPool({ chains: ['evm'] });
    const events = collectEvents(pool);
    const tracked = trackedSource(evmItem, { count: 300 });

    await pool.scanAll({ evm: evmStreamInput(tracked.source) });

    const processed = events.map((e) => e.processed);
    expect(processed[0]).toBe(0);
    expect(processed[processed.length - 1]).toBe(300);
    // Mid-stream events are throttled, so there are far fewer than 300 of them.
    expect(events.length).toBeLessThan(20);
    for (const event of events) {
      expect(event.buffered ?? 0).toBeLessThanOrEqual(256);
      expect(event.streaming).toBe(true);
    }
  });

  it('accepts arrays and streams together across chains', async () => {
    const pool = new MultichainScannerPool({ chains: ['evm', 'solana'] });
    const results = await pool.scanAll({
      evm: { announcements: [evmItem(), evmItem()], ...evmKeys },
      solana: solanaStreamInput(trackedSource(solanaItem, { count: 10 }).source),
    });

    expect(results.evm).toEqual([]);
    expect(results.solana).toEqual([]);
  });

  it('rejects an input that provides both announcements and source', async () => {
    const pool = new MultichainScannerPool({ chains: ['evm'] });
    const input = {
      announcements: [evmItem()],
      source: trackedSource(evmItem, { count: 1 }).source,
      ...evmKeys,
    } as EvmScanInput;

    await expect(pool.scanAll({ evm: input })).rejects.toThrow(/not both/);
  });

  it('rejects an input that provides neither announcements nor source', async () => {
    const pool = new MultichainScannerPool({ chains: ['evm'] });
    await expect(pool.scanAll({ evm: { ...evmKeys } as EvmScanInput })).rejects.toThrow(
      /requires a "announcements" array or a "source"/,
    );
  });

  it('rejects a source that is not async iterable', async () => {
    const pool = new MultichainScannerPool({ chains: ['evm'] });
    const input = { source: [evmItem()], ...evmKeys } as unknown as EvmScanInput;
    await expect(pool.scanAll({ evm: input })).rejects.toThrow(/not async iterable/);
  });
});

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

describe('MultichainScannerPool – per-chain bounds', () => {
  it('never exceeds the in-flight request budget', async () => {
    const pool = new MultichainScannerPool({
      chains: ['evm'],
      requestBudget: { maxInFlightRequests: 3, maxBufferedAnnouncements: 64 },
    });
    for (let run = 0; run < 3; run++) {
      const tracked = trackedSource(evmItem, { count: 400, latencyMs: 1 });
      await pool.scanAll({ evm: evmStreamInput(tracked.source) });

      expect(tracked.stats.peakInFlight).toBeGreaterThan(0);
      expect(tracked.stats.peakInFlight).toBeLessThanOrEqual(3);
    }
  });

  it('never buffers more than the buffer budget', async () => {
    const pool = new MultichainScannerPool({
      chains: ['evm'],
      budgets: { evm: { maxBufferedAnnouncements: 4, maxInFlightRequests: 2 } },
    });
    const events = collectEvents(pool);
    const tracked = trackedSource(evmItem, { count: 1000, latencyMs: 1 });

    await pool.scanAll({ evm: evmStreamInput(tracked.source) });

    const peakBuffered = Math.max(...events.map((e) => e.buffered ?? 0));
    expect(peakBuffered).toBeLessThanOrEqual(4);
    // Pull-ahead is bounded too: the producer can never be more than one
    // buffer ahead of the scanner, ignoring the throttled progress sampling.
    for (const event of events) {
      expect((event.requests ?? 0) - event.processed).toBeLessThanOrEqual(4 + 2);
    }
  });

  it('fails when a stream needs more pulls than its request budget', async () => {
    const pool = new MultichainScannerPool({
      chains: ['evm'],
      requestBudget: { maxRequests: 3 },
    });
    const tracked = trackedSource(evmItem, { count: 1000 });

    const error = await pool.scanAll({ evm: evmStreamInput(tracked.source) }).catch((e) => e);

    expect(error).toBeInstanceOf(ScanBudgetExceededError);
    expect(error.code).toBe('WRAITH/INPUT/SCAN_BUDGET_EXCEEDED');
    expect(error.context).toMatchObject({ chain: 'evm', kind: 'requests', limit: 3 });
    expect(tracked.stats.pulls).toBe(3);
    expect(tracked.stats.returned).toBe(true);
  });

  it('does not count materialized arrays against the request budget', async () => {
    const pool = new MultichainScannerPool({
      chains: ['evm'],
      requestBudget: { maxRequests: 2 },
    });
    const announcements = Array.from({ length: 5000 }, evmItem);

    const results = await pool.scanAll({ evm: { announcements, ...evmKeys } });

    expect(results.evm).toEqual([]);
  });

  it('applies per-chain budgets independently', async () => {
    const pool = new MultichainScannerPool({
      chains: ['evm', 'solana'],
      failFast: false,
      budgets: {
        evm: { maxRequests: 2 },
        solana: { maxRequests: 1000 },
      },
    });
    const events = collectEvents(pool);
    const evm = trackedSource(evmItem, { count: 500 });
    const solana = trackedSource(solanaItem, { count: 20 });

    const error = await pool
      .scanAll({
        evm: evmStreamInput(evm.source),
        solana: solanaStreamInput(solana.source),
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ScanBudgetExceededError);
    expect(error.context.chain).toBe('evm');
    // The Solana chain had a larger budget and still completed.
    const solanaFinal = events.filter((e) => e.chain === 'solana').pop();
    expect(solanaFinal?.processed).toBe(20);
    expect(solana.stats.returned).toBe(true);
  });

  it('rejects invalid budget limits instead of running unbounded', async () => {
    const pool = new MultichainScannerPool({
      chains: ['evm'],
      requestBudget: { maxBufferedAnnouncements: 0 },
    });
    const tracked = trackedSource(evmItem, { count: 5 });

    await expect(pool.scanAll({ evm: evmStreamInput(tracked.source) })).rejects.toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Fairness between chains
// ---------------------------------------------------------------------------

describe('MultichainScannerPool – fairness', () => {
  it('a slow chain does not starve a fast chain under the same scheduler', async () => {
    const pool = new MultichainScannerPool({
      chains: ['evm', 'solana'],
      concurrency: 2,
    });
    const events = collectEvents(pool);
    const slowEvm = trackedSource(evmItem, { count: 40, latencyMs: 5 });
    const fastSolana = trackedSource(solanaItem, { count: 200 });

    await pool.scanAll({
      evm: evmStreamInput(slowEvm.source),
      solana: solanaStreamInput(fastSolana.source),
    });

    const firstSolanaFinal = events.findIndex((e) => e.chain === 'solana' && e.processed === 200);
    const evmFinal = events.findIndex((e) => e.chain === 'evm' && e.processed === 40);
    expect(firstSolanaFinal).toBeGreaterThanOrEqual(0);
    expect(evmFinal).toBeGreaterThanOrEqual(0);
    expect(firstSolanaFinal).toBeLessThan(evmFinal);
  });

  it('keeps the global chain concurrency as the outer scheduler', async () => {
    const pool = new MultichainScannerPool({ chains: ['evm', 'solana'], concurrency: 1 });
    const events: ProgressEvent[] = [];
    let solanaStarted = false;
    pool.on('progress', (event) => {
      events.push(event);
      if (event.chain === 'solana') solanaStarted = true;
      if (event.chain === 'evm' && event.processed === 40) {
        // EVM must have finished before Solana starts with concurrency 1.
        expect(solanaStarted).toBe(false);
      }
    });

    await pool.scanAll({
      evm: evmStreamInput(trackedSource(evmItem, { count: 40, latencyMs: 1 }).source),
      solana: solanaStreamInput(trackedSource(solanaItem, { count: 40 }).source),
    });

    expect(solanaStarted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

describe('MultichainScannerPool – cancellation drains streams', () => {
  it('rejects with AbortError and closes every source', async () => {
    const pool = new MultichainScannerPool({ chains: ['evm', 'solana'], concurrency: 2 });
    const evm = trackedSource(evmItem, { count: 100_000, latencyMs: 2 });
    const solana = trackedSource(solanaItem, { count: 100_000, latencyMs: 2 });
    const controller = new AbortController();

    const scan = pool.scanAll(
      { evm: evmStreamInput(evm.source), solana: solanaStreamInput(solana.source) },
      controller.signal,
    );

    // Let both chains start pulling, then cancel mid-scan.
    await delay(15);
    controller.abort();

    await expect(scan).rejects.toMatchObject({ name: 'AbortError' });
    expect(evm.stats.returned).toBe(true);
    expect(solana.stats.returned).toBe(true);

    // No further pulls after the scan settled.
    const pullsAfterAbort = evm.stats.pulls + solana.stats.pulls;
    await delay(20);
    expect(evm.stats.pulls + solana.stats.pulls).toBe(pullsAfterAbort);
  });

  it('cancels the other chains when one fails under failFast', async () => {
    const pool = new MultichainScannerPool({
      chains: ['evm', 'solana'],
      concurrency: 2,
      requestBudget: { maxRequests: 2 },
    });
    const evm = trackedSource(evmItem, { count: 10 });
    const solana = trackedSource(solanaItem, { count: 100_000, latencyMs: 1 });

    const error = await pool
      .scanAll({
        evm: evmStreamInput(evm.source),
        // A budget large enough that only the EVM failure can stop this chain.
        solana: solanaStreamInput(solana.source, { budget: { maxRequests: 100_000 } }),
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ScanBudgetExceededError);
    expect(error.context.chain).toBe('evm');
    expect(solana.stats.returned).toBe(true);
  });

  it('rejects before touching any source when already aborted', async () => {
    const pool = new MultichainScannerPool({ chains: ['evm'] });
    const tracked = trackedSource(evmItem, { count: 10 });
    const controller = new AbortController();
    controller.abort();

    await expect(
      pool.scanAll({ evm: evmStreamInput(tracked.source) }, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(tracked.stats.pulls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Backpressure does not leak listeners or timers
// ---------------------------------------------------------------------------

describe('MultichainScannerPool – cleanup', () => {
  it('stops pulling and releases the source once a scan settles', async () => {
    const pool = new MultichainScannerPool({ chains: ['evm'] });
    const tracked = trackedSource(evmItem, { count: 200 });

    await pool.scanAll({ evm: evmStreamInput(tracked.source) });

    const pullsAfterScan = tracked.stats.pulls;
    await delay(20);
    expect(tracked.stats.pulls).toBe(pullsAfterScan);
    expect(tracked.stats.returned).toBe(true);
  });

  it('emits a final event with buffered=0 for every chain', async () => {
    const pool = new MultichainScannerPool({ chains: ['evm', 'solana'] });
    const events = collectEvents(pool);

    await pool.scanAll({
      evm: evmStreamInput(trackedSource(evmItem, { count: 130 }).source),
      solana: { announcements: [solanaItem()], ...solanaKeys },
    });

    const finals = ['evm', 'solana'].map((chain) => events.filter((e) => e.chain === chain).pop());
    for (const event of finals) {
      expect(event).toMatchObject({ buffered: 0 });
      expect(event?.processed).toBeGreaterThanOrEqual(0);
    }
    expect(finals[0]?.processed).toBe(130);
    expect(finals[1]?.processed).toBe(1);
  });
});
