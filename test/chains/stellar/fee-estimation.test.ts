import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Horizon, SorobanRpc } from '@stellar/stellar-sdk';
import {
  estimateStellarFee,
  parseFeeStats,
} from '../../../src/chains/stellar/fee-estimation';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFeeStats(
  overrides?: Partial<Horizon.FeeStatsResponse>,
): Horizon.FeeStatsResponse {
  return {
    last_ledger: '12345',
    last_ledger_base_fee: '100',
    ledger_capacity_usage: '0.45',
    fee_charged: {
      min: '100',
      max: '10000',
      mode: '200',
      p10: '100',
      p20: '150',
      p30: '200',
      p40: '250',
      p50: '300',
      p60: '400',
      p70: '600',
      p80: '900',
      p90: '1500',
      p95: '2000',
      p99: '5000',
    },
    max_fee: {
      min: '100',
      max: '50000',
      mode: '1000',
      p10: '200',
      p20: '400',
      p30: '600',
      p40: '800',
      p50: '1000',
      p60: '1500',
      p70: '2000',
      p80: '3000',
      p90: '5000',
      p95: '7500',
      p99: '10000',
    },
    ...overrides,
  } as Horizon.FeeStatsResponse;
}

function makeSimResult(
  minResourceFee = '5000',
): SorobanRpc.Api.SimulateTransactionSuccessResponse {
  return {
    id: 'sim-1',
    latestLedger: 9999,
    minResourceFee,
    results: [],
    transactionData: '' as unknown as SorobanRpc.Api.SimulateTransactionSuccessResponse['transactionData'],
    events: [],
    cost: { cpuInsns: '1000', memBytes: '512' },
  } as unknown as SorobanRpc.Api.SimulateTransactionSuccessResponse;
}

function makeSimError(
  error = 'out of gas',
): SorobanRpc.Api.SimulateTransactionErrorResponse {
  return {
    id: 'sim-err',
    latestLedger: 9999,
    error,
    events: [],
  } as unknown as SorobanRpc.Api.SimulateTransactionErrorResponse;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockHorizonFeeStats(stats: Horizon.FeeStatsResponse = makeFeeStats()) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => stats,
  });
}

function mockHorizonError(status = 503) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText: 'Service Unavailable',
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseFeeStats', () => {
  it('extracts baseFee, p50, and p99 correctly', () => {
    const result = parseFeeStats(makeFeeStats());
    expect(result.baseFee).toBe(100);
    expect(result.p50).toBe(300);
    expect(result.p99).toBe(5000);
  });

  it('falls back to 100 when last_ledger_base_fee is 0', () => {
    const result = parseFeeStats(makeFeeStats({ last_ledger_base_fee: '0' }));
    expect(result.baseFee).toBe(100);
  });

  it('falls back to baseFee when fee_charged is absent', () => {
    const stats = { ...makeFeeStats(), fee_charged: undefined } as Horizon.FeeStatsResponse;
    const result = parseFeeStats(stats);
    expect(result.p50).toBe(result.baseFee);
    expect(result.p99).toBe(result.baseFee);
  });
});

describe('estimateStellarFee — classic ops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns correct low / expected / high for a single-op tx', async () => {
    const estimate = await estimateStellarFee({
      operationCount: 1,
      feeStats: makeFeeStats(),
    });

    expect(estimate.low).toBe(100);       // baseFee × 1
    expect(estimate.expected).toBe(300);  // p50 × 1
    expect(estimate.high).toBe(10_000);   // p99 × 2 × 1
  });

  it('scales linearly with op count', async () => {
    const estimate = await estimateStellarFee({
      operationCount: 3,
      feeStats: makeFeeStats(),
    });

    expect(estimate.low).toBe(300);
    expect(estimate.expected).toBe(900);
    expect(estimate.high).toBe(30_000);
  });

  it('fetches fee stats from Horizon when not pre-fetched', async () => {
    mockHorizonFeeStats();
    const estimate = await estimateStellarFee({ operationCount: 1 });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('fee_stats'),
    );
    expect(estimate.low).toBeGreaterThan(0);
  });

  it('uses a custom horizonUrl when provided', async () => {
    mockHorizonFeeStats();
    await estimateStellarFee({
      operationCount: 1,
      horizonUrl: 'https://my-horizon.example.com',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://my-horizon.example.com/fee_stats',
    );
  });

  it('throws on Horizon error', async () => {
    mockHorizonError();
    await expect(
      estimateStellarFee({ operationCount: 1 }),
    ).rejects.toThrow('Horizon /fee_stats request failed: 503');
  });

  it('throws on negative operationCount', async () => {
    await expect(
      estimateStellarFee({ operationCount: -1, feeStats: makeFeeStats() }),
    ).rejects.toThrow('operationCount must be >= 0');
  });

  it('treats 0 operationCount as 1 effective op', async () => {
    const estimate = await estimateStellarFee({
      operationCount: 0,
      feeStats: makeFeeStats(),
    });
    expect(estimate.breakdown.operationCount).toBe(1);
    expect(estimate.low).toBe(100);
  });

  it('populates breakdown correctly', async () => {
    const estimate = await estimateStellarFee({
      operationCount: 1,
      feeStats: makeFeeStats(),
    });
    expect(estimate.breakdown.networkBaseFee).toBe(100);
    expect(estimate.breakdown.feeBumpApplied).toBe(false);
    expect(estimate.breakdown.sorobanResourceFee).toBeUndefined();
    expect(estimate.breakdown.uncertainty).toContain('recent ledger data');
  });

  it('always satisfies low <= expected <= high', async () => {
    const estimate = await estimateStellarFee({
      operationCount: 2,
      feeStats: makeFeeStats(),
    });
    expect(estimate.low).toBeLessThanOrEqual(estimate.expected);
    expect(estimate.expected).toBeLessThanOrEqual(estimate.high);
  });
});

describe('estimateStellarFee — fee-bump', () => {
  it('adds 1 extra op for the fee-bump outer envelope', async () => {
    const estimate = await estimateStellarFee({
      operationCount: 2,
      feeStats: makeFeeStats(),
      feeBump: true,
    });
    expect(estimate.breakdown.operationCount).toBe(3);
    expect(estimate.breakdown.feeBumpApplied).toBe(true);
    expect(estimate.breakdown.uncertainty).toContain('Fee-bump');
  });

  it('fee-bump estimate is higher than plain estimate', async () => {
    const stats = makeFeeStats();
    const plain = await estimateStellarFee({ operationCount: 2, feeStats: stats });
    const bumped = await estimateStellarFee({ operationCount: 2, feeStats: stats, feeBump: true });
    expect(bumped.low).toBeGreaterThan(plain.low);
  });
});

describe('estimateStellarFee — Soroban (pre-fetched simulation)', () => {
  it('adds sorobanResourceFee to all tiers', async () => {
    const estimate = await estimateStellarFee({
      operationCount: 1,
      feeStats: makeFeeStats(),
      sorobanResources: {
        transactionXdr: 'AAAAAQ==',
        simulationResult: makeSimResult('5000'),
      },
    });

    const resourceFee = 5_000;
    const padding = Math.ceil(5_000 * 0.25); // 1250

    expect(estimate.low).toBe(100 + resourceFee);
    expect(estimate.expected).toBe(300 + resourceFee);
    expect(estimate.high).toBe(10_000 + resourceFee + padding);
    expect(estimate.breakdown.sorobanResourceFee).toBe(5_000);
    expect(estimate.breakdown.sorobanPadding).toBe(padding);
  });

  it('throws when simulation returns an error', async () => {
    await expect(
      estimateStellarFee({
        operationCount: 1,
        feeStats: makeFeeStats(),
        sorobanResources: {
          transactionXdr: 'AAAAAQ==',
          simulationResult: makeSimError('wasm trap') as unknown as SorobanRpc.Api.SimulateTransactionResponse,
        },
      }),
    ).rejects.toThrow('Soroban simulation failed: wasm trap');
  });

  it('uncertainty note mentions simulateTransaction and 25% padding', async () => {
    const estimate = await estimateStellarFee({
      operationCount: 1,
      feeStats: makeFeeStats(),
      sorobanResources: {
        transactionXdr: 'AAAAAQ==',
        simulationResult: makeSimResult('1000'),
      },
    });
    expect(estimate.breakdown.uncertainty).toContain('simulateTransaction');
    expect(estimate.breakdown.uncertainty).toContain('25%');
  });

  it('Soroban + fee-bump combined is additive', async () => {
    const estimate = await estimateStellarFee({
      operationCount: 1,
      feeStats: makeFeeStats(),
      feeBump: true,
      sorobanResources: {
        transactionXdr: 'AAAAAQ==',
        simulationResult: makeSimResult('3000'),
      },
    });

    // effective ops = 1 + 1 (fee-bump) = 2
    expect(estimate.breakdown.operationCount).toBe(2);
    expect(estimate.breakdown.feeBumpApplied).toBe(true);
    expect(estimate.breakdown.sorobanResourceFee).toBe(3_000);

    const resourceFee = 3_000;
    const padding = Math.ceil(3_000 * 0.25); // 750
    const highInclusion = 5_000 * 2 * 2; // p99 × surge × 2 ops

    expect(estimate.high).toBe(highInclusion + resourceFee + padding);
  });
});