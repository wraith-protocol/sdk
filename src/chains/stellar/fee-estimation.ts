/**
 * Stellar Fee Estimation Utility
 *
 * Estimates transaction fees for both classic Stellar operations and
 * Soroban smart contract invocations. Returns a low/expected/high range
 * to help stealth payment senders budget before submitting.
 *
 * Uncertainty notes:
 * - Classic fee estimates are based on the last-ledger base fee reported
 *   by Horizon. Actual acceptance depends on network congestion at submission
 *   time. The "high" tier applies a 2× surge multiplier which is conservative
 *   but not a guarantee of inclusion.
 * - Soroban resource fees are derived from simulateTransaction. The simulation
 *   reflects the current ledger state and may differ if state changes before
 *   submission. Always add headroom.
 * - Fee-bump outer fees add 1 base fee unit for the outer envelope (CAP-0015).
 * - All values are in stroops (1 XLM = 10,000,000 stroops).
 */

import type { Horizon, Soroban } from '@stellar/stellar-sdk';
import type { Network } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Soroban resource data needed for simulation-based fee estimation. */
export interface SorobanResources {
  /**
   * Serialised transaction XDR to simulate.
   * Required when simulationResult is not pre-fetched.
   */
  transactionXdr: string;
  /**
   * Pre-fetched simulation result. If provided, no RPC call is made.
   */
  simulationResult?: Soroban.Api.SimulateTransactionResponse;
}

/** Parameters for fee estimation. */
export interface EstimateFeeParams {
  /**
   * Number of classic operations in the transaction.
   * For a pure Soroban invocation this is typically 1 (invokeHostFunction).
   */
  operationCount: number;
  /** Soroban-specific data. Omit for classic-only transactions. */
  sorobanResources?: SorobanResources;
  /** Target network. Defaults to 'testnet'. */
  network?: Network;
  /**
   * Pre-fetched fee stats from Horizon (/fee_stats).
   * If omitted, the helper fetches them itself.
   */
  feeStats?: Horizon.FeeStatsResponse;
  /**
   * Set to true when the transaction will be wrapped in a fee-bump envelope.
   * Adds one extra base-fee unit for the outer transaction (CAP-0015).
   */
  feeBump?: boolean;
  /** Custom Soroban RPC URL. Overrides the default for the selected network. */
  rpcUrl?: string;
  /** Custom Horizon URL. Overrides the default for the selected network. */
  horizonUrl?: string;
}

/** Fee estimate in stroops, broken into three tiers. */
export interface FeeEstimate {
  /**
   * Minimum viable fee — protocol minimum only.
   * Likely rejected under any congestion.
   */
  low: number;
  /**
   * Recommended fee — p50 (median) from recent ledgers.
   * Suitable for most non-urgent transactions.
   */
  expected: number;
  /**
   * High-priority fee — p99 with 2× surge buffer.
   * Maximises inclusion chances during congestion.
   */
  high: number;
  /** Breakdown of every component that makes up the estimate. */
  breakdown: FeeBreakdown;
}

/** Human-readable breakdown for debugging and surfacing uncertainty to users. */
export interface FeeBreakdown {
  /** Per-operation base fee from the last ledger (stroops). */
  networkBaseFee: number;
  /** Effective operation count used in the calculation. */
  operationCount: number;
  /** Soroban resource fee from simulation (stroops). Only present for Soroban. */
  sorobanResourceFee?: number;
  /** Extra padding added to the Soroban resource fee for the "high" tier. */
  sorobanPadding?: number;
  /** Whether a fee-bump +1 base-fee unit was applied. */
  feeBumpApplied: boolean;
  /** Horizon p50 inclusion fee (stroops/op) from recent ledgers. */
  p50Fee?: number;
  /** Horizon p99 inclusion fee (stroops/op) from recent ledgers. */
  p99Fee?: number;
  /** Human-readable note about estimate uncertainty. */
  uncertainty: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Stellar protocol minimum base fee per operation (stroops). */
const PROTOCOL_MIN_BASE_FEE = 100;

/** Surge multiplier applied on top of p99 for the "high" tier. */
const HIGH_SURGE_MULTIPLIER = 2;

/**
 * Soroban resource fee padding for the "high" tier (25%).
 * Accounts for ledger state drift between simulation and submission.
 */
const SOROBAN_HIGH_PADDING_PERCENT = 0.25;

const HORIZON_URLS: Record<Network, string> = {
  mainnet: 'https://horizon.stellar.org',
  testnet: 'https://horizon-testnet.stellar.org',
};

const RPC_URLS: Record<Network, string> = {
  mainnet: 'https://soroban-rpc.stellar.org',
  testnet: 'https://soroban-testnet.stellar.org',
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Fetch and parse fee stats from Horizon /fee_stats. */
async function fetchFeeStats(
  horizonUrl: string,
): Promise<{ baseFee: number; p50: number; p99: number }> {
  const res = await fetch(`${horizonUrl}/fee_stats`);
  if (!res.ok) {
    throw new Error(
      `Horizon /fee_stats request failed: ${res.status} ${res.statusText}`,
    );
  }
  const data = (await res.json()) as Horizon.FeeStatsResponse;
  return parseFeeStats(data);
}

/** Parse a Horizon FeeStatsResponse into the numbers we need. */
export function parseFeeStats(data: Horizon.FeeStatsResponse): {
  baseFee: number;
  p50: number;
  p99: number;
} {
  const baseFee =
    parseInt(data.last_ledger_base_fee, 10) || PROTOCOL_MIN_BASE_FEE;
  const p50 =
    parseInt(data.fee_charged?.p50 ?? data.last_ledger_base_fee, 10) ||
    baseFee;
  const p99 =
    parseInt(data.fee_charged?.p99 ?? data.last_ledger_base_fee, 10) ||
    baseFee;
  return { baseFee, p50, p99 };
}

/** Run simulateTransaction via the Soroban RPC endpoint. */
async function runSimulation(
  transactionXdr: string,
  rpcUrl: string,
): Promise<Soroban.Api.SimulateTransactionResponse> {
  const { SorobanRpc: SorobanRpcModule, TransactionBuilder } = await import(
    '@stellar/stellar-sdk'
  );
  const server = new SorobanRpcModule.Server(rpcUrl);
  const tx = TransactionBuilder.fromXDR(transactionXdr, 'base64');
  return server.simulateTransaction(
    tx as Parameters<typeof server.simulateTransaction>[0],
  );
}

/** Extract resource fee in stroops from a simulation result. Throws on error. */
function extractSorobanResourceFee(
  result: Soroban.Api.SimulateTransactionResponse,
): number {
  if ('error' in result) {
    throw new Error(
      `Soroban simulation failed: ${(result as Soroban.Api.SimulateTransactionErrorResponse).error}`,
    );
  }
  if ('restorePreamble' in result) {
    return (
      parseInt(
        (result as Soroban.Api.SimulateTransactionRestoreResponse)
          .restorePreamble.minResourceFee,
        10,
      ) || 0
    );
  }
  const fee = parseInt(
    (result as Soroban.Api.SimulateTransactionSuccessResponse).minResourceFee,
    10,
  );
  return isNaN(fee) ? 0 : fee;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Estimate the fee for a Stellar transaction.
 *
 * Handles three scenarios:
 * 1. Classic ops only — multiplies network base fee by op count with p50/p99 tiers.
 * 2. Soroban — adds the resource fee from simulation on top of the inclusion fee.
 * 3. Fee-bump — adds one base-fee unit for the outer envelope (CAP-0015).
 *
 * All returned values are in stroops (1 XLM = 10,000,000 stroops).
 *
 * @example
 * ```ts
 * const estimate = await estimateStellarFee({ operationCount: 1, network: 'mainnet' });
 * console.log(estimate.expected); // e.g. 1000 stroops
 * ```
 */
export async function estimateStellarFee(
  params: EstimateFeeParams,
): Promise<FeeEstimate> {
  const {
    operationCount,
    sorobanResources,
    network = 'testnet',
    feeBump = false,
    rpcUrl,
    horizonUrl,
  } = params;

  if (operationCount < 0) {
    throw new Error('operationCount must be >= 0');
  }

  // Step 1: resolve fee stats
  let baseFee: number;
  let p50: number;
  let p99: number;

  if (params.feeStats) {
    ({ baseFee, p50, p99 } = parseFeeStats(params.feeStats));
  } else {
    const hUrl = horizonUrl ?? HORIZON_URLS[network];
    ({ baseFee, p50, p99 } = await fetchFeeStats(hUrl));
  }

  // Step 2: resolve Soroban resource fee
  let sorobanResourceFee = 0;
  let simulationUsed = false;

  if (sorobanResources) {
    simulationUsed = true;
    let simResult = sorobanResources.simulationResult;
    if (!simResult) {
      const rUrl = rpcUrl ?? RPC_URLS[network];
      simResult = await runSimulation(sorobanResources.transactionXdr, rUrl);
    }
    sorobanResourceFee = extractSorobanResourceFee(simResult);
  }

  // Step 3: compute inclusion fee tiers
  // Fee-bump adds 1 for the outer envelope per CAP-0015
  const effectiveOps = feeBump ? operationCount + 1 : operationCount;
  const safeOps = Math.max(effectiveOps, 1);

  const inclusionLow = baseFee * safeOps;
  const inclusionExpected = Math.max(p50, baseFee) * safeOps;
  const inclusionHigh =
    Math.max(p99, baseFee) * HIGH_SURGE_MULTIPLIER * safeOps;

  // Step 4: add Soroban resource fee
  const sorobanPadding = simulationUsed
    ? Math.ceil(sorobanResourceFee * SOROBAN_HIGH_PADDING_PERCENT)
    : 0;

  const low = inclusionLow + sorobanResourceFee;
  const expected = inclusionExpected + sorobanResourceFee;
  const high = inclusionHigh + sorobanResourceFee + sorobanPadding;

  // Step 5: assemble result
  const uncertainty = buildUncertaintyNote({ simulationUsed, feeBump, network });

  const breakdown: FeeBreakdown = {
    networkBaseFee: baseFee,
    operationCount: safeOps,
    feeBumpApplied: feeBump,
    p50Fee: p50,
    p99Fee: p99,
    uncertainty,
    ...(simulationUsed && { sorobanResourceFee, sorobanPadding }),
  };

  return { low, expected, high, breakdown };
}

function buildUncertaintyNote(opts: {
  simulationUsed: boolean;
  feeBump: boolean;
  network: Network;
}): string {
  const parts: string[] = [
    'Fee estimates are based on recent ledger data and may change before submission.',
  ];
  if (opts.simulationUsed) {
    parts.push(
      'Soroban resource fee comes from simulateTransaction and may shift if ledger state changes.',
    );
    parts.push(
      `The "high" tier adds ${Math.round(SOROBAN_HIGH_PADDING_PERCENT * 100)}% padding to the resource fee.`,
    );
  }
  if (opts.feeBump) {
    parts.push(
      'Fee-bump outer envelope adds 1 extra base-fee unit (CAP-0015).',
    );
  }
  if (opts.network === 'mainnet') {
    parts.push(
      'Mainnet congestion can spike beyond p99 during high-traffic periods.',
    );
  }
  return parts.join(' ');
}