/**
 * Fee estimation tests.
 *
 * Unit tests use a mocked Horizon `/fee_stats` response.
 * Integration tests (skipped by default) submit to futurenet.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { estimateFee, clearFeeCache, type FeeStats, type OperationKind } from '../../../src/chains/stellar/fee';

const SKIP = process.env['INTEGRATION'] !== '1';

// Mock fee stats response
const mockFeeStats: FeeStats = {
  ledger: 47889216,
  last_ledger_base_fee: '100',
  fee_charged: {
    max: '10000',
    min: '100',
    mode: '500',
    p10: '150',
    p20: '300',
    p30: '400',
    p40: '600',
    p50: '1000',
    p60: '1200',
    p70: '1500',
    p80: '2000',
    p90: '5000',
    p99: '10000',
  },
  max_fee: {
    max: '100000',
    min: '1000',
    mode: '5000',
    p10: '1500',
    p20: '3000',
    p30: '4000',
    p40: '6000',
    p50: '10000',
    p60: '12000',
    p70: '15000',
    p80: '20000',
    p90: '50000',
    p99: '100000',
  },
};

describe('estimateFee', () => {
  beforeEach(() => {
    clearFeeCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearFeeCache();
  });

  test('returns p10 (low urgency)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => mockFeeStats,
    })));

    const fee = await estimateFee('payment', 'low');
    expect(fee).toBe(150);
  });

  test('returns p50 (normal urgency)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => mockFeeStats,
    })));

    const fee = await estimateFee('payment', 'normal');
    expect(fee).toBe(1000);
  });

  test('returns p90 (high urgency)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => mockFeeStats,
    })));

    const fee = await estimateFee('payment', 'high');
    expect(fee).toBe(5000);
  });

  test('enforces minimum fee of 100 stroops', async () => {
    const lowStats = {
      ...mockFeeStats,
      fee_charged: {
        ...mockFeeStats.fee_charged,
        p10: '50', // Below minimum
      },
    };

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => lowStats,
    })));

    const fee = await estimateFee('payment', 'low');
    expect(fee).toBe(100);
  });

  test('works with various operation kinds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => mockFeeStats,
    })));

    const opKinds: OperationKind[] = [
      'payment',
      'manage_sell_offer',
      'path_payment_strict_receive',
      'invoke_host_function',
    ];

    for (const kind of opKinds) {
      const fee = await estimateFee(kind, 'normal');
      expect(fee).toBe(1000);
    }
  });

  test('defaults to normal urgency', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => mockFeeStats,
    }));

    const fee = await estimateFee('payment');
    expect(fee).toBe(1000);
  });

  test('caches results for 30 seconds', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => mockFeeStats,
    }));

    vi.stubGlobal('fetch', fetchMock);

    // First call should fetch
    const fee1 = await estimateFee('payment', 'normal', 'https://horizon-testnet.stellar.org');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call should use cache
    const fee2 = await estimateFee('payment', 'normal', 'https://horizon-testnet.stellar.org');
    expect(fetchMock).toHaveBeenCalledTimes(1); // Still 1, not 2
    expect(fee1).toBe(fee2);
  });

  test('caches per Horizon URL', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => mockFeeStats,
    }));

    vi.stubGlobal('fetch', fetchMock);

    // Different URLs should make separate requests
    await estimateFee('payment', 'normal', 'https://horizon-testnet.stellar.org');
    await estimateFee('payment', 'normal', 'https://horizon.stellar.org');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('throws on failed Horizon request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })));

    await expect(estimateFee('payment', 'normal')).rejects.toThrow(
      'Horizon fee_stats request failed: 500 Internal Server Error',
    );
  });

  test('throws on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('Network error');
    }));

    await expect(estimateFee('payment', 'normal')).rejects.toThrow('Network error');
  });

  test('clears cache on clearFeeCache()', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => mockFeeStats,
    }));

    vi.stubGlobal('fetch', fetchMock);

    // First call
    await estimateFee('payment', 'normal', 'https://horizon-testnet.stellar.org');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Clear cache
    clearFeeCache();

    // Second call should fetch again
    await estimateFee('payment', 'normal', 'https://horizon-testnet.stellar.org');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('Integration: estimateFee on futurenet', { skip: SKIP }, () => {
  test('fetches real fee stats and returns positive stroops', async () => {
    const futurenetUrl = 'https://horizon-futurenet.stellar.org';

    const fee = await estimateFee('payment', 'normal', futurenetUrl);

    expect(typeof fee).toBe('number');
    expect(fee).toBeGreaterThanOrEqual(100);
    expect(Number.isInteger(fee)).toBe(true);
  });

  test('high urgency fee is >= normal urgency fee', async () => {
    const futurenetUrl = 'https://horizon-futurenet.stellar.org';

    const normalFee = await estimateFee('payment', 'normal', futurenetUrl);
    const highFee = await estimateFee('payment', 'high', futurenetUrl);

    expect(highFee).toBeGreaterThanOrEqual(normalFee);
  });
});
