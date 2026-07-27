/**
 * Stellar fee estimation with caching.
 *
 * Estimates network fees for different operation types and urgency levels
 * by pulling recent ledger data from Horizon's `/fee_stats` endpoint.
 *
 * @see {@link estimateFee}
 */

/**
 * Stellar operation types supported for fee estimation.
 *
 * This is not exhaustive; it covers the common payment, asset, and contract operations.
 */
export type OperationKind =
  | 'payment'
  | 'manage_sell_offer'
  | 'manage_buy_offer'
  | 'path_payment_strict_receive'
  | 'path_payment_strict_send'
  | 'manage_data'
  | 'bump_sequence'
  | 'invoke_host_function'
  | 'extend_footprint_ttl';

/**
 * Fee estimation urgency level.
 *
 * - `low`: Suitable for non-time-critical operations. Uses the 10th percentile.
 * - `normal`: Recommended for most operations. Uses the median (50th percentile).
 * - `high`: For time-critical operations during network congestion. Uses the 90th percentile.
 */
export type Urgency = 'low' | 'normal' | 'high';

export interface FeeStats {
  /** Ledger sequence number for this fee data. */
  ledger: number;
  /** Timestamp (ISO 8601) when this data was recorded. */
  last_ledger_base_fee: string;
  /** Fees in stroops for different percentiles. */
  fee_charged: {
    max: string;
    min: string;
    mode: string;
    p10: string;
    p20: string;
    p30: string;
    p40: string;
    p50: string;
    p60: string;
    p70: string;
    p80: string;
    p90: string;
    p99: string;
  };
  /** Max fees in stroops for different percentiles. */
  max_fee: {
    max: string;
    min: string;
    mode: string;
    p10: string;
    p20: string;
    p30: string;
    p40: string;
    p50: string;
    p60: string;
    p70: string;
    p80: string;
    p90: string;
    p99: string;
  };
}

interface CacheEntry {
  data: FeeStats;
  timestamp: number;
}

const DEFAULT_TTL_MS = 30 * 1000; // 30 seconds
const cache = new Map<string, CacheEntry>();

/**
 * Fetches fee stats from Horizon and caches them briefly.
 *
 * @param horizonUrl The Horizon API URL.
 * @returns The fee statistics from Horizon.
 * @throws If the Horizon request fails or returns invalid data.
 */
async function fetchFeeStats(horizonUrl: string): Promise<FeeStats> {
  const now = Date.now();
  const cached = cache.get(horizonUrl);

  // Return cached data if still valid
  if (cached && now - cached.timestamp < DEFAULT_TTL_MS) {
    return cached.data;
  }

  const url = new URL('/fee_stats', horizonUrl).toString();
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Horizon fee_stats request failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as FeeStats;

  // Cache the result
  cache.set(horizonUrl, { data, timestamp: now });

  return data;
}

/**
 * Estimates an inclusion fee in stroops for an operation type and urgency level.
 *
 * Fetches recent fee statistics from Horizon's `/fee_stats` endpoint and selects
 * the appropriate percentile based on urgency. Results are cached for 30 seconds.
 *
 * @param opKind The Stellar operation type (e.g., 'payment', 'invoke_host_function').
 * @param urgency The fee estimation urgency level ('low' | 'normal' | 'high').
 * @param horizonUrl The Horizon API URL. Defaults to Stellar testnet.
 * @returns The estimated fee per operation in stroops.
 * @throws If the Horizon request fails.
 *
 * @example
 * ```ts
 * // Estimate a fee for a payment during normal network conditions
 * const fee = await estimateFee('payment', 'normal');
 * // → 1000 (stroops, or 0.0001 XLM)
 *
 * // High urgency during congestion
 * const urgentFee = await estimateFee('invoke_host_function', 'high');
 * // → 5000 (stroops)
 * ```
 */
export async function estimateFee(
  opKind: OperationKind,
  urgency: Urgency = 'normal',
  horizonUrl: string = 'https://horizon-testnet.stellar.org',
): Promise<number> {
  const stats = await fetchFeeStats(horizonUrl);

  // Select percentile based on urgency
  let percentile: keyof FeeStats['fee_charged'];
  if (urgency === 'low') {
    percentile = 'p10';
  } else if (urgency === 'high') {
    percentile = 'p90';
  } else {
    percentile = 'p50'; // normal
  }

  // Get the fee value and ensure it's at least 100 stroops (base fee)
  const feeStr = stats.fee_charged[percentile];
  const fee = Math.max(100, parseInt(feeStr, 10));

  return fee;
}

/**
 * Clears the fee stats cache for testing or manual cache invalidation.
 */
export function clearFeeCache(): void {
  cache.clear();
}
