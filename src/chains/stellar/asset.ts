import type { Network } from './types';
import { UnsupportedAssetError } from '../../errors';
import { Account, Contract, TransactionBuilder, rpc } from '@stellar/stellar-sdk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Metadata for a SEP-41 / Soroban custom asset contract.
 */
export interface AssetMetadata {
  /** Human-readable name, e.g. `"USDC"`. */
  name: string;
  /** Trading symbol, e.g. `"USDC"`. */
  symbol: string;
  /** Number of decimal places (0–18). */
  decimals: number;
}

/**
 * Options for {@link getAssetMetadata}.
 */
export interface GetAssetMetadataOptions {
  /** Override the Soroban RPC URL. */
  rpcUrl?: string;
  /** Bypass the in-memory metadata cache. */
  bypassCache?: boolean;
}

/**
 * Options for {@link getAssetBalance}.
 */
export interface GetAssetBalanceOptions {
  /** Override the Soroban RPC URL. */
  rpcUrl?: string;
}

// ---------------------------------------------------------------------------
// SEP-41 method names
// ---------------------------------------------------------------------------

const METADATA_METHODS = {
  name: 'name',
  symbol: 'symbol',
  decimals: 'decimals',
} as const;

const BALANCE_METHOD = 'balance';

// ---------------------------------------------------------------------------
// Metadata cache
// ---------------------------------------------------------------------------

interface CachedMetadata {
  metadata: AssetMetadata;
  fetchedAt: number;
}

const METADATA_CACHE = new Map<string, CachedMetadata>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheKey(contractId: string, network: Network, rpcUrl: string): string {
  return `${network}:${rpcUrl}:${contractId}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveRpcUrl(network: Network, override?: string): string {
  if (override) return override;
  return network === 'mainnet'
    ? 'https://soroban-rpc.stellar.org'
    : 'https://soroban-testnet.stellar.org';
}

async function callContractMethod<T>(
  contractId: string,
  method: string,
  args: unknown[],
  rpcUrl: string,
): Promise<T> {
  const server = new rpc.Server(rpcUrl);
  const contract = new Contract(contractId);

  // Build the contract operation
  const operation = contract.call(method, ...(args as [any, ...any[]]));

  // Simulate to get the result without submitting
  const sourceAccount = new Account(
    'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    '12345',
  );
  const tx = new TransactionBuilder(sourceAccount, {
    networkPassphrase: rpcUrl.includes('testnet')
      ? 'Test SDF Network ; September 2015'
      : 'Public Global Stellar Network ; September 2015',
    fee: '100',
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const simResult = (await server.simulateTransaction(tx)) as any;

  // Type guard for error response
  if ('error' in simResult) {
    throw new Error(`SEP-41 contract call "${method}" failed: ${simResult.error}`);
  }

  // Type guard for success response
  if (!simResult.result || !simResult.result.retval) {
    throw new Error(`SEP-41 contract call "${method}" returned no result`);
  }

  // Decode the return value based on expected type
  const scv = simResult.result.retval;

  if (method === METADATA_METHODS.decimals) {
    return Number(scv.u32()) as T;
  }

  if (method === METADATA_METHODS.name || method === METADATA_METHODS.symbol) {
    // Decode string from ScVal
    const str = (scv as any).sym?.toString() || (scv as any).str?.toString();
    if (typeof str !== 'string') {
      throw new Error(`Unexpected return type for "${method}": expected string`);
    }
    return str as T;
  }

  if (method === BALANCE_METHOD) {
    // Decode i128 balance
    const raw = (scv as any).i128?.lo?.()?.toString() || '0';
    return BigInt(raw) as T;
  }

  throw new Error(`Unsupported method: ${method}`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetches metadata (name, symbol, decimals) for a SEP-41 custom asset contract.
 *
 * Results are cached in-memory for the session. Metadata rarely changes on
 * deployed contracts, so repeated calls are cheap after the first fetch.
 *
 * @param contractId - The Soroban contract ID of the SEP-41 token.
 * @param network - Stellar network (`'testnet'` or `'mainnet'`).
 * @param opts - Optional RPC override and cache bypass.
 * @returns Asset metadata including name, symbol, and decimals.
 * @throws {Error} If the contract does not implement SEP-41 or the RPC call fails.
 *
 * @example
 * ```ts
 * import { getAssetMetadata } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const meta = await getAssetMetadata(
 *   'CCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
 *   'testnet',
 * );
 * console.log(meta.name, meta.symbol, meta.decimals);
 * ```
 */
export async function getAssetMetadata(
  contractId: string,
  network: Network = 'testnet',
  opts: GetAssetMetadataOptions = {},
): Promise<AssetMetadata> {
  const rpcUrl = resolveRpcUrl(network, opts.rpcUrl);
  const key = cacheKey(contractId, network, rpcUrl);

  // Check cache
  if (!opts.bypassCache) {
    const cached = METADATA_CACHE.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.metadata;
    }
  }

  // Fetch all three metadata fields in parallel
  const [name, symbol, decimals] = await Promise.all([
    callContractMethod<string>(contractId, METADATA_METHODS.name, [], rpcUrl),
    callContractMethod<string>(contractId, METADATA_METHODS.symbol, [], rpcUrl),
    callContractMethod<number>(contractId, METADATA_METHODS.decimals, [], rpcUrl),
  ]);

  const metadata: AssetMetadata = { name, symbol, decimals };

  // Update cache
  METADATA_CACHE.set(key, { metadata, fetchedAt: Date.now() });

  return metadata;
}

/**
 * Returns the custom asset balance for a Stellar account.
 *
 * Calls the SEP-41 `balance(address)` view method on the token contract.
 *
 * @param contractId - The Soroban contract ID of the SEP-41 token.
 * @param address - The Stellar public key (G...) of the account to query.
 * @param network - Stellar network (`'testnet'` or `'mainnet'`).
 * @param opts - Optional RPC override.
 * @returns Balance in the token's smallest unit (raw integer).
 * @throws {Error} If the contract does not implement SEP-41 or the RPC call fails.
 *
 * @example
 * ```ts
 * import { getAssetBalance } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const balance = await getAssetBalance(
 *   'CCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
 *   'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
 *   'testnet',
 * );
 * console.log(`Balance: ${balance}`);
 * ```
 */
export async function getAssetBalance(
  contractId: string,
  address: string,
  network: Network = 'testnet',
  opts: GetAssetBalanceOptions = {},
): Promise<bigint> {
  const rpcUrl = resolveRpcUrl(network, opts.rpcUrl);

  // Basic validation
  if (!address.startsWith('G') || address.length !== 56) {
    throw new UnsupportedAssetError(
      `Invalid Stellar address: "${address}". Expected a G... public key.`,
      network,
    );
  }

  const balance = await callContractMethod<bigint>(contractId, BALANCE_METHOD, [address], rpcUrl);

  return balance;
}

/**
 * Clears the in-memory metadata cache.
 *
 * Useful in tests or when you want to force a fresh fetch.
 */
export function clearAssetMetadataCache(): void {
  METADATA_CACHE.clear();
}
