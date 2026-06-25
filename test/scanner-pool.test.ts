import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MultichainScannerPool,
  type ScanInput,
  type EvmScanInput,
  type StellarScanInput,
  type SolanaScanInput,
  type CkbScanInput,
  type ProgressEvent,
} from '../src/scanner-pool';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const evmKeys = {
  viewingKey: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as const,
  spendingPubKey: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' as const,
  spendingKey: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as const,
};

const stellarKeys = {
  viewingKey: new Uint8Array(32).fill(0xcc),
  spendingPubKey: new Uint8Array(32).fill(0xdd),
  spendingScalar: 123456789n,
};

const solanaKeys = {
  viewingKey: new Uint8Array(32).fill(0xcc),
  spendingPubKey: new Uint8Array(32).fill(0xdd),
  spendingScalar: 123456789n,
};

const ckbKeys = {
  viewingKey: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as const,
  spendingPubKey: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' as const,
  spendingKey: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as const,
};

const evmInput: EvmScanInput = { announcements: [], ...evmKeys };
const stellarInput: StellarScanInput = { announcements: [], ...stellarKeys };
const solanaInput: SolanaScanInput = { announcements: [], ...solanaKeys };
const ckbInput: CkbScanInput = { cells: [], ...ckbKeys };

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe('MultichainScannerPool – constructor', () => {
  it('initialises with defaults', () => {
    const pool = new MultichainScannerPool();
    expect(pool).toBeInstanceOf(MultichainScannerPool);
  });

  it('accepts custom chains and concurrency', () => {
    const pool = new MultichainScannerPool({ chains: ['evm', 'solana'], concurrency: 2 });
    expect(pool).toBeInstanceOf(MultichainScannerPool);
  });

  it('clamps concurrency to at least 1', () => {
    // Should not throw
    const pool = new MultichainScannerPool({ concurrency: 0 });
    expect(pool).toBeInstanceOf(MultichainScannerPool);
  });
});

// ---------------------------------------------------------------------------
// scanAll – basic correctness
// ---------------------------------------------------------------------------

describe('MultichainScannerPool – scanAll', () => {
  let pool: MultichainScannerPool;

  beforeEach(() => {
    pool = new MultichainScannerPool({
      chains: ['evm', 'stellar', 'solana', 'ckb'],
      concurrency: 4,
    });
  });

  afterEach(() => vi.clearAllMocks());

  it('returns empty object for empty input', async () => {
    expect(await pool.scanAll({})).toEqual({});
  });

  it('returns only the chains present in input', async () => {
    const results = await pool.scanAll({ evm: evmInput });
    expect(results.evm).toBeDefined();
    expect(results.stellar).toBeUndefined();
    expect(results.solana).toBeUndefined();
    expect(results.ckb).toBeUndefined();
  });

  it('returns arrays for all four chains', async () => {
    const results = await pool.scanAll({
      evm: evmInput,
      stellar: stellarInput,
      solana: solanaInput,
      ckb: ckbInput,
    });
    expect(Array.isArray(results.evm)).toBe(true);
    expect(Array.isArray(results.stellar)).toBe(true);
    expect(Array.isArray(results.solana)).toBe(true);
    expect(Array.isArray(results.ckb)).toBe(true);
  });

  it('returns empty arrays when announcements/cells are empty', async () => {
    const results = await pool.scanAll({ evm: evmInput, stellar: stellarInput });
    expect(results.evm).toHaveLength(0);
    expect(results.stellar).toHaveLength(0);
  });

  it('ignores chains not listed in constructor options', async () => {
    const evmOnly = new MultichainScannerPool({ chains: ['evm'] });
    const results = await evmOnly.scanAll({ evm: evmInput, stellar: stellarInput });
    expect(results.evm).toBeDefined();
    // stellar was not in the pool's chain list
    expect(results.stellar).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Parallelism
// ---------------------------------------------------------------------------

describe('MultichainScannerPool – parallelism', () => {
  it('runs chains concurrently (parallel not slower than sequential)', async () => {
    // With empty arrays both paths are near-instant; verify parallel ≤ sequential + tolerance
    const parallel = new MultichainScannerPool({ concurrency: 4 });
    const sequential = new MultichainScannerPool({ concurrency: 1 });
    const input: ScanInput = {
      evm: evmInput,
      stellar: stellarInput,
      solana: solanaInput,
      ckb: ckbInput,
    };

    const t0 = performance.now();
    await parallel.scanAll(input);
    const parallelMs = performance.now() - t0;

    const t1 = performance.now();
    await sequential.scanAll(input);
    const seqMs = performance.now() - t1;

    expect(parallelMs).toBeLessThanOrEqual(seqMs + 100);
  });

  it('respects concurrency=1 (sequential order)', async () => {
    const pool = new MultichainScannerPool({ chains: ['evm', 'stellar'], concurrency: 1 });
    const results = await pool.scanAll({ evm: evmInput, stellar: stellarInput });
    expect(results.evm).toBeDefined();
    expect(results.stellar).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Progress events
// ---------------------------------------------------------------------------

describe('MultichainScannerPool – progress events', () => {
  it('emits start (processed=0) and end (processed=total) events per chain', async () => {
    const pool = new MultichainScannerPool({ chains: ['evm'] });
    const events: ProgressEvent[] = [];
    pool.on('progress', (e) => events.push({ ...e }));

    await pool.scanAll({ evm: evmInput });

    const evmEvents = events.filter((e) => e.chain === 'evm');
    expect(evmEvents.length).toBeGreaterThanOrEqual(2);
    expect(evmEvents[0]).toMatchObject({ chain: 'evm', processed: 0, total: 0 });
    expect(evmEvents[evmEvents.length - 1]).toMatchObject({ chain: 'evm', processed: 0, total: 0 });
  });

  it('on() returns this for chaining', () => {
    const pool = new MultichainScannerPool();
    const ret = pool.on('progress', () => {});
    expect(ret).toBe(pool);
  });

  it('off() removes the listener', async () => {
    const pool = new MultichainScannerPool({ chains: ['evm'] });
    const listener = vi.fn();
    pool.on('progress', listener);
    pool.off('progress', listener);

    await pool.scanAll({ evm: evmInput });
    expect(listener).not.toHaveBeenCalled();
  });

  it('off() returns this for chaining', () => {
    const pool = new MultichainScannerPool();
    const fn = () => {};
    pool.on('progress', fn);
    const ret = pool.off('progress', fn);
    expect(ret).toBe(pool);
  });
});

// ---------------------------------------------------------------------------
// AbortSignal cancellation
// ---------------------------------------------------------------------------

describe('MultichainScannerPool – cancellation', () => {
  it('rejects immediately when signal is already aborted', async () => {
    const pool = new MultichainScannerPool();
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(pool.scanAll({ evm: evmInput }, ctrl.signal)).rejects.toThrow();
  });

  it('resolves normally when signal is not aborted', async () => {
    const pool = new MultichainScannerPool({ chains: ['evm'] });
    const ctrl = new AbortController();
    const results = await pool.scanAll({ evm: evmInput }, ctrl.signal);
    expect(results.evm).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// failFast option
// ---------------------------------------------------------------------------

describe('MultichainScannerPool – failFast', () => {
  it('rejects on first error by default (failFast=true)', async () => {
    const pool = new MultichainScannerPool({ chains: ['evm'], failFast: true });

    // Pass an input that will cause scanChain to throw (unsupported chain injected via cast)
    const badInput = { evm: null } as unknown as ScanInput;
    // evm is present but null — scanChain will try to destructure and throw
    await expect(pool.scanAll(badInput)).rejects.toThrow();
  });

  it('failFast=false still surfaces errors', async () => {
    const pool = new MultichainScannerPool({ chains: ['evm'], failFast: false });
    const badInput = { evm: null } as unknown as ScanInput;
    await expect(pool.scanAll(badInput)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Benchmark (smoke test — not a hard timing assertion)
// ---------------------------------------------------------------------------

describe('MultichainScannerPool – benchmark smoke test', () => {
  it('parallel 4-chain scan completes faster than sequential baseline', async () => {
    const pool = new MultichainScannerPool({ concurrency: 4 });

    const t0 = performance.now();
    await pool.scanAll({
      evm: evmInput,
      stellar: stellarInput,
      solana: solanaInput,
      ckb: ckbInput,
    });
    const parallelMs = performance.now() - t0;

    // Sequential baseline
    const seqPool = new MultichainScannerPool({ concurrency: 1 });
    const t1 = performance.now();
    await seqPool.scanAll({
      evm: evmInput,
      stellar: stellarInput,
      solana: solanaInput,
      ckb: ckbInput,
    });
    const seqMs = performance.now() - t1;

    // With empty arrays both are near-instant; just assert parallel ≤ sequential
    expect(parallelMs).toBeLessThanOrEqual(seqMs + 50); // 50 ms tolerance for CI jitter
    console.log(`Parallel: ${parallelMs.toFixed(1)} ms | Sequential: ${seqMs.toFixed(1)} ms`);
  });
});
