/**
 * Integration tests: estimateStellarFee against live Stellar testnet.
 *
 * Makes real HTTP requests to:
 *   - https://horizon-testnet.stellar.org/fee_stats
 *
 * Run with:
 *   $env:INTEGRATION="1"; pnpm exec vitest run test/chains/stellar/fee-estimation.integration.test.ts
 *
 * Skipped by default in CI unless INTEGRATION=1 is set.
 */

import { describe, it, expect } from 'vitest';
import { estimateStellarFee } from '../../../src/chains/stellar/fee-estimation';

const SKIP = process.env['INTEGRATION'] !== '1';

describe('Integration: estimateStellarFee (testnet)', { skip: SKIP }, () => {
  it('returns a valid fee range for a classic 1-op transaction', async () => {
    const estimate = await estimateStellarFee({
      operationCount: 1,
      network: 'testnet',
    });

    expect(estimate.low).toBeGreaterThanOrEqual(100);
    expect(estimate.low).toBeLessThanOrEqual(estimate.expected);
    expect(estimate.expected).toBeLessThanOrEqual(estimate.high);
    expect(estimate.high).toBeLessThan(10_000_000);
    expect(estimate.breakdown.networkBaseFee).toBeGreaterThanOrEqual(100);
    expect(estimate.breakdown.feeBumpApplied).toBe(false);
    expect(estimate.breakdown.sorobanResourceFee).toBeUndefined();

    console.log('[Integration] Classic 1-op estimate (stroops):', {
      low: estimate.low,
      expected: estimate.expected,
      high: estimate.high,
      networkBaseFee: estimate.breakdown.networkBaseFee,
    });
  }, 15_000);

  it('scales correctly for a 3-op transaction', async () => {
    const estimate = await estimateStellarFee({
      operationCount: 3,
      network: 'testnet',
    });

    expect(estimate.low).toBeGreaterThanOrEqual(300);
    expect(estimate.breakdown.operationCount).toBe(3);
    expect(estimate.low).toBeLessThanOrEqual(estimate.expected);
    expect(estimate.expected).toBeLessThanOrEqual(estimate.high);
  }, 15_000);

  it('fee-bump adds 1 effective op', async () => {
    const bumped = await estimateStellarFee({
      operationCount: 2,
      network: 'testnet',
      feeBump: true,
    });

    expect(bumped.breakdown.operationCount).toBe(3);
    expect(bumped.breakdown.feeBumpApplied).toBe(true);
    expect(bumped.low).toBeGreaterThanOrEqual(300);
  }, 15_000);
});
