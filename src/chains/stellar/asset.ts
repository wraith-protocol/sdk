import type { Network } from './types';
import { UnsupportedAssetError } from '../../errors';
import {
  Account,
  Address,
  Contract,
  StrKey,
  TransactionBuilder,
  rpc,
  scValToNative,
  type xdr,
} from '@stellar/stellar-sdk';

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
 * Which SEP-41 metadata field a failure belongs to.
 */
export type AssetMetadataField = 'name' | 'symbol' | 'decimals';

/**
 * Why one metadata field could not be read.
 *
 * - `missing` - the contract does not expose the method, or returned nothing.
 * - `invalid` - a value came back but it is not a usable one, for example a
 *   `decimals` outside 0 to 18 or a non-string `symbol`.
 * - `rpc-error` - the call itself failed, so nothing is known about the field.
 */
export type AssetMetadataFailureReason = 'missing' | 'invalid' | 'rpc-error';

/**
 * One field that could not be read, and why.
 */
export interface AssetMetadataFailure {
  /** The field that failed. */
  field: AssetMetadataField;
  /** Why it failed. */
  reason: AssetMetadataFailureReason;
  /** Human-readable detail, suitable for logging. */
  message: string;
}

/**
 * Outcome of a metadata read, covering the partial cases that
 * {@link getAssetMetadata} can only express by throwing.
 *
 * - `complete` - all three fields read and validated.
 * - `partial` - at least one field read, at least one failed.
 * - `unsupported` - no field could be read, so the contract is probably not
 *   SEP-41, or the RPC is unreachable. Read `failures` to tell those apart.
 */
export type AssetMetadataResult =
  | { status: 'complete'; metadata: AssetMetadata; failures: readonly AssetMetadataFailure[] }
  | {
      status: 'partial';
      metadata: Partial<AssetMetadata>;
      failures: readonly AssetMetadataFailure[];
    }
  | {
      status: 'unsupported';
      metadata: Partial<AssetMetadata>;
      failures: readonly AssetMetadataFailure[];
    };

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

/**
 * The ScVal types each SEP-41 method may return, as `ScValType` names.
 *
 * SEP-41 declares `name` and `symbol` as `String`. `Symbol` is accepted as
 * well, since it is also text and some deployed tokens return it.
 */
const RETURN_TYPES: Readonly<Record<string, readonly string[]>> = {
  [METADATA_METHODS.name]: ['scvString', 'scvSymbol'],
  [METADATA_METHODS.symbol]: ['scvString', 'scvSymbol'],
  [METADATA_METHODS.decimals]: ['scvU32'],
  [BALANCE_METHOD]: ['scvI128'],
};

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

/** Largest `decimals` a SEP-41 token may declare. */
const MAX_DECIMALS = 18;

/**
 * A contract call that failed in a way we can classify.
 *
 * The reason is what lets {@link getAssetMetadataResult} distinguish "this
 * contract has no `name` method" from "the RPC was down", which the previous
 * code flattened into one generic `Error`.
 */
class MetadataFieldError extends Error {
  constructor(
    message: string,
    readonly reason: AssetMetadataFailureReason,
  ) {
    super(message);
    this.name = 'MetadataFieldError';
  }
}

/**
 * Classifies a simulation error string.
 *
 * Soroban reports an absent function as a host error rather than a distinct
 * status, so the text is all there is to go on. Anything unrecognised is
 * treated as an RPC problem, which is the safer default: it keeps a transient
 * outage from being cached as "this contract is not a token".
 */
function classifySimulationError(detail: string): AssetMetadataFailureReason {
  return /missing|not\s*found|non-?existent|unsupported|no\s*such|UnknownFunction|InvalidAction/i.test(
    detail,
  )
    ? 'missing'
    : 'rpc-error';
}

/**
 * Validates a `name` or `symbol` response.
 *
 * The ScVal type has already been checked, so this is text. An empty string or
 * whitespace is still not a usable label, and caching it would poison every
 * later read for the session.
 */
function validateLabel(field: AssetMetadataField, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MetadataFieldError(
      `SEP-41 contract returned an unusable "${field}": expected a non-empty string, got ${describe(value)}`,
      'invalid',
    );
  }
  return value;
}

/**
 * Validates a `decimals` response.
 *
 * The ScVal type has already been checked to be a `u32`, so this bounds it to 0
 * to {@link MAX_DECIMALS}, the range {@link AssetMetadata.decimals} documents.
 * The integer check stays as a guard: a `NaN` here would not throw, it would
 * flow into every amount calculation downstream instead.
 */
function validateDecimals(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_DECIMALS) {
    throw new MetadataFieldError(
      `SEP-41 contract returned an unusable "decimals": expected an integer 0 to ${MAX_DECIMALS}, got ${describe(value)}`,
      'invalid',
    );
  }
  return n;
}

/** Short, safe rendering of an unexpected value for an error message. */
function describe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.slice(0, 40));
  if (typeof value === 'bigint') return `${value}n`;
  if (value === null) return 'null';
  if (typeof value === 'object') return Object.prototype.toString.call(value);
  return String(value);
}

/**
 * Checks a contract's return value against the SEP-41 type and decodes it.
 *
 * `retval` is an `xdr.ScVal`: a union whose arms are read through methods
 * (`str()`, `sym()`, `u32()`, `i128()`), each of which throws when called on
 * another arm. The arm is therefore checked first, with `switch()`, so a
 * contract that returns the wrong type is reported as `invalid` instead of
 * surfacing as an exception that would be misread as an RPC failure. The
 * decoding itself is left to the SDK's `scValToNative`: UTF-8 text for
 * `String` and `Symbol`, a number for `u32`, and a bigint built from both
 * 64-bit halves for `i128`.
 */
function decodeReturnValue(method: string, scv: xdr.ScVal): unknown {
  const type = scv.switch().name;

  // A function that returns nothing. Nothing is known about the field, which
  // is the same `missing` case as a simulation without a result.
  if (type === 'scvVoid') {
    throw new MetadataFieldError(`SEP-41 contract call "${method}" returned no result`, 'missing');
  }

  const expected = RETURN_TYPES[method];
  if (!expected) {
    throw new MetadataFieldError(`Unsupported method: ${method}`, 'missing');
  }
  if (!expected.includes(type)) {
    throw new MetadataFieldError(
      `SEP-41 contract returned an unusable "${method}": expected ${expected.join(' or ')}, got ${type}`,
      'invalid',
    );
  }

  const value: unknown = scValToNative(scv);
  if (method === METADATA_METHODS.decimals) return validateDecimals(value);
  if (method === BALANCE_METHOD) return value;
  return validateLabel(method as AssetMetadataField, value);
}

async function callContractMethod<T>(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  rpcUrl: string,
): Promise<T> {
  const server = new rpc.Server(rpcUrl);
  const contract = new Contract(contractId);

  // Build the contract operation
  const operation = contract.call(method, ...args);

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

  let sim: rpc.Api.SimulateTransactionResponse;
  try {
    sim = await server.simulateTransaction(tx);
  } catch (cause) {
    throw new MetadataFieldError(
      `SEP-41 contract call "${method}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      'rpc-error',
    );
  }

  if (rpc.Api.isSimulationError(sim)) {
    throw new MetadataFieldError(
      `SEP-41 contract call "${method}" failed: ${sim.error}`,
      classifySimulationError(sim.error),
    );
  }

  // A simulation that succeeded without a result returned nothing, so this is
  // the "missing" case rather than a transport failure.
  if (!sim.result?.retval) {
    throw new MetadataFieldError(`SEP-41 contract call "${method}" returned no result`, 'missing');
  }

  return decodeReturnValue(method, sim.result.retval) as T;
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
  const result = await getAssetMetadataResult(contractId, network, opts);
  if (result.status === 'complete') return result.metadata;

  // Preserve the original contract: the first failure in field order is the one
  // that surfaces, with the message it always had.
  const first = result.failures[0];
  throw new Error(first?.message ?? `SEP-41 metadata unavailable for ${contractId}`);
}

/** Field order, and therefore the order failures are reported in. */
const METADATA_FIELDS: readonly AssetMetadataField[] = ['name', 'symbol', 'decimals'] as const;

/**
 * Reads SEP-41 metadata and reports what could and could not be read.
 *
 * {@link getAssetMetadata} can only say "all three fields" or "an exception", so
 * a token that implements `symbol` and `decimals` but not `name`, which is
 * common on older Soroban deployments, is indistinguishable from a contract that
 * is not a token at all. This returns that distinction instead.
 *
 * Only a `complete` result is cached. A partial read caused by a flaky RPC must
 * not pin a half-empty record in front of every later call for the cache
 * lifetime, and an `unsupported` result must not pin a wrong verdict either.
 *
 * @param contractId - The Soroban contract ID of the SEP-41 token.
 * @param network - Stellar network (`'testnet'` or `'mainnet'`).
 * @param opts - Optional RPC override and cache bypass.
 * @returns A discriminated result: `complete`, `partial` or `unsupported`.
 *
 * @example
 * ```ts
 * const result = await getAssetMetadataResult(contractId, 'testnet');
 * if (result.status === 'complete') {
 *   render(result.metadata);
 * } else if (result.status === 'partial') {
 *   render({ name: result.metadata.name ?? 'Unknown token', ...result.metadata });
 * } else {
 *   const transient = result.failures.every((f) => f.reason === 'rpc-error');
 *   transient ? retryLater() : markNotAToken();
 * }
 * ```
 */
export async function getAssetMetadataResult(
  contractId: string,
  network: Network = 'testnet',
  opts: GetAssetMetadataOptions = {},
): Promise<AssetMetadataResult> {
  const rpcUrl = resolveRpcUrl(network, opts.rpcUrl);
  const key = cacheKey(contractId, network, rpcUrl);

  // Check cache
  if (!opts.bypassCache) {
    const cached = METADATA_CACHE.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return { status: 'complete', metadata: cached.metadata, failures: [] };
    }
  }

  // Fetch all three in parallel. allSettled, not all, so one absent method does
  // not discard the two that answered.
  const settled = await Promise.allSettled([
    callContractMethod<string>(contractId, METADATA_METHODS.name, [], rpcUrl),
    callContractMethod<string>(contractId, METADATA_METHODS.symbol, [], rpcUrl),
    callContractMethod<number>(contractId, METADATA_METHODS.decimals, [], rpcUrl),
  ]);

  const metadata: Partial<AssetMetadata> = {};
  const failures: AssetMetadataFailure[] = [];

  settled.forEach((outcome, index) => {
    const field = METADATA_FIELDS[index];
    if (outcome.status === 'fulfilled') {
      if (field === 'decimals') metadata.decimals = outcome.value as number;
      else metadata[field] = outcome.value as string;
      return;
    }
    const error = outcome.reason;
    failures.push({
      field,
      reason: error instanceof MetadataFieldError ? error.reason : 'rpc-error',
      message: error instanceof Error ? error.message : String(error),
    });
  });

  if (failures.length === 0) {
    const complete = metadata as AssetMetadata;
    METADATA_CACHE.set(key, { metadata: complete, fetchedAt: Date.now() });
    return { status: 'complete', metadata: complete, failures: [] };
  }

  return {
    status: failures.length === METADATA_FIELDS.length ? 'unsupported' : 'partial',
    metadata,
    failures,
  };
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

  // A full strkey check, checksum included, so a malformed key fails here with
  // a typed error rather than inside the SDK's Address constructor below.
  if (!StrKey.isValidEd25519PublicKey(address)) {
    throw new UnsupportedAssetError(
      `Invalid Stellar address: "${address}". Expected a G... public key.`,
      network,
    );
  }

  // SEP-41 declares `balance(id: Address)`, so the account goes in as an
  // Address ScVal. A plain string cannot be encoded into the transaction.
  const balance = await callContractMethod<bigint>(
    contractId,
    BALANCE_METHOD,
    [Address.fromString(address).toScVal()],
    rpcUrl,
  );

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
