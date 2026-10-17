import { Account, Contract, TransactionBuilder, rpc, xdr } from '@stellar/stellar-sdk';
import {
  ContractRevertError,
  InvalidMetaAddressError,
  InvalidNameError,
  NameNotFoundError,
  RPCAbortedError,
  RPCRequestError,
  WraithError,
  WalletWrongNetworkError,
} from '../../errors';
import { META_ADDRESS_PREFIX } from './constants';
import { DEPLOYMENTS, getDeployment, type StellarChainDeployment } from './deployments';
import { decodeStealthMetaAddress, encodeStealthMetaAddress } from './meta-address';

/** Default in-memory TTL for resolved Stellar `.wraith` names (5 minutes). */
export const DEFAULT_STELLAR_NAME_TTL_MS = 5 * 60 * 1000;

const MIN_LABEL_LEN = 3;
const MAX_NAME_LEN = 32;
const LABEL_PATTERN = /^[a-z0-9]+$/;
const DUMMY_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

/**
 * Options for {@link resolveStellarName}.
 */
export interface ResolveStellarNameOptions {
  /** Override the Soroban RPC URL from the configured deployment. */
  rpcUrl?: string;
  /** Override the Wraith Names contract ID from the configured deployment. */
  contractId?: string;
  /** Override the Stellar network passphrase used for simulation. */
  networkPassphrase?: string;
  /** Bypass the in-memory positive resolution cache. */
  bypassCache?: boolean;
  /** Override the cache TTL in milliseconds for this lookup (`0` disables caching). */
  ttlMs?: number;
  /** Optional signal to cancel the in-flight Soroban RPC simulation. */
  signal?: AbortSignal;
  /** Throw {@link NameNotFoundError} instead of returning `null` when unregistered. */
  throwOnNotFound?: boolean;
}

interface CachedNameEntry {
  metaAddress: string;
  expiresAt: number;
}

const NAME_CACHE = new Map<string, CachedNameEntry>();
let defaultTtlMs = DEFAULT_STELLAR_NAME_TTL_MS;

/**
 * Normalizes and validates a Stellar `.wraith` name according to the on-chain
 * `wraith-names` contract rules (`3..=32` chars, lowercase ASCII alphanumeric,
 * optional single-level subdomain `sub.parent`, trailing `.wraith` stripped).
 *
 * @param name - Raw name string (e.g. `"alice.wraith"`, `"alice"`, `"pay.alice.wraith"`).
 * @returns Normalized contract lookup key without the `.wraith` suffix.
 * @throws {InvalidNameError} If the name is empty, too short/long, or contains invalid characters/labels.
 */
export function normalizeStellarName(name: string): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new InvalidNameError(String(name ?? ''), 'Name must be a non-empty string');
  }

  const stripped = name.endsWith('.wraith') ? name.slice(0, -7) : name;
  if (stripped.length < MIN_LABEL_LEN || stripped.length > MAX_NAME_LEN) {
    throw new InvalidNameError(
      name,
      `Name must be between ${MIN_LABEL_LEN} and ${MAX_NAME_LEN} characters, got ${stripped.length}`,
    );
  }

  const labels = stripped.split('.');
  if (labels.length > 2) {
    throw new InvalidNameError(name, 'Subdomains deeper than one level are not supported');
  }

  for (const label of labels) {
    if (label.length < MIN_LABEL_LEN) {
      throw new InvalidNameError(
        name,
        `Each name label must be at least ${MIN_LABEL_LEN} characters`,
      );
    }
    if (!LABEL_PATTERN.test(label)) {
      throw new InvalidNameError(
        name,
        'Name labels may only contain lowercase alphanumeric characters (a-z, 0-9)',
      );
    }
  }

  return stripped;
}

function resolveNamesDeployment(
  chain: string,
  options: ResolveStellarNameOptions,
): {
  deployment: StellarChainDeployment;
  rpcUrl: string;
  contractId: string;
  networkPassphrase: string;
} {
  const key = chain === 'testnet' && !DEPLOYMENTS.testnet ? 'stellar' : chain;
  let deployment: StellarChainDeployment;
  try {
    deployment = getDeployment(key);
  } catch (cause) {
    throw new WalletWrongNetworkError({
      chain: 'stellar',
      expectedNetwork: DEPLOYMENTS.stellar?.network ?? 'testnet',
      actualNetwork: chain,
      reason: `No Stellar Wraith Names deployment is configured for network "${chain}"`,
      cause,
    });
  }

  if (deployment.network && chain !== 'stellar' && deployment.network !== chain) {
    throw new WalletWrongNetworkError({
      chain: 'stellar',
      expectedNetwork: deployment.network,
      actualNetwork: chain,
    });
  }

  const expectedPassphrase =
    deployment.networkPassphrase ?? DEPLOYMENTS.stellar?.networkPassphrase ?? '';
  if (
    options.networkPassphrase &&
    expectedPassphrase &&
    options.networkPassphrase !== expectedPassphrase
  ) {
    throw new WalletWrongNetworkError({
      chain: 'stellar',
      expectedNetwork: expectedPassphrase,
      actualNetwork: options.networkPassphrase,
    });
  }

  const contractId = options.contractId ?? deployment.contracts?.names;
  const rpcUrl =
    options.rpcUrl ??
    deployment.sorobanUrl ??
    (deployment as unknown as { rpcUrl?: string }).rpcUrl ??
    DEPLOYMENTS.stellar.sorobanUrl;

  if (!contractId) {
    throw new WalletWrongNetworkError({
      chain: 'stellar',
      expectedNetwork: deployment.network ?? 'testnet',
      actualNetwork: chain,
      reason: `No Wraith Names contract is configured for network "${chain}"`,
    });
  }

  return {
    deployment,
    rpcUrl,
    contractId,
    networkPassphrase: options.networkPassphrase ?? expectedPassphrase,
  };
}

function raceWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  url: string,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new RPCAbortedError(url, { cause: signal.reason }));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new RPCAbortedError(url, { cause: signal.reason }));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function parseMetaAddressPayload(retval: xdr.ScVal): string | null {
  const arm = retval.switch().name;
  if (arm === 'scvVoid') {
    return null;
  }

  if (arm === 'scvError') {
    const err = retval.error();
    if (err.switch().name === 'sceContract' && err.contractCode() === 6) {
      return null;
    }
    throw new ContractRevertError(`Error(Contract, #${err.contractCode()})`);
  }

  if (arm === 'scvString' || arm === 'scvSymbol') {
    const text = arm === 'scvString' ? retval.str().toString() : retval.sym().toString();
    decodeStealthMetaAddress(text);
    return text;
  }

  if (arm === 'scvBytes') {
    const raw = Uint8Array.from(retval.bytes());
    if (raw.length > META_ADDRESS_PREFIX.length) {
      const text = new TextDecoder().decode(raw);
      if (text.startsWith(META_ADDRESS_PREFIX)) {
        decodeStealthMetaAddress(text);
        return text;
      }
    }
    if (raw.length !== 64) {
      throw new InvalidMetaAddressError(
        '',
        `Wraith Names contract returned ${raw.length} bytes, expected 64`,
      );
    }
    return encodeStealthMetaAddress(raw.subarray(0, 32), raw.subarray(32, 64));
  }

  throw new InvalidMetaAddressError(
    '',
    `Unexpected ScVal return type "${arm}" from Wraith Names contract`,
  );
}

/**
 * Resolves a `.wraith` name on Stellar via the configured Soroban `wraith-names` contract.
 *
 * Positive resolutions are cached in memory for {@link DEFAULT_STELLAR_NAME_TTL_MS}
 * (unless overridden or bypassed). Unregistered names (`null`) and errors are never cached.
 *
 * @param name - The `.wraith` name to resolve (with or without `.wraith`).
 * @param chain - Configured Stellar deployment or network name (`'testnet'` or `'stellar'`).
 * @param options - Optional RPC/contract overrides, cache controls, and `AbortSignal`.
 * @returns The validated `st:xlm:...` stealth meta-address, or `null` when not found.
 */
export async function resolveStellarName(
  name: string,
  chain = 'testnet',
  options: ResolveStellarNameOptions = {},
): Promise<string | null> {
  const fallbackUrl = options.rpcUrl ?? DEPLOYMENTS.stellar.sorobanUrl;
  if (options.signal?.aborted) {
    throw new RPCAbortedError(fallbackUrl, { cause: options.signal.reason });
  }

  const normalized = normalizeStellarName(name);
  const { deployment, rpcUrl, contractId, networkPassphrase } = resolveNamesDeployment(
    chain,
    options,
  );

  if (options.signal?.aborted) {
    throw new RPCAbortedError(rpcUrl, { cause: options.signal.reason });
  }

  const ttl = options.ttlMs ?? defaultTtlMs;
  const cacheKey = `${deployment.network ?? chain}:${rpcUrl}:${contractId}:${normalized}`;

  if (!options.bypassCache && ttl > 0) {
    const cached = NAME_CACHE.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.metaAddress;
    }
    if (cached) {
      NAME_CACHE.delete(cacheKey);
    }
  }

  const server = new rpc.Server(rpcUrl);
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(new Account(DUMMY_SOURCE, '0'), {
    networkPassphrase,
    fee: '100',
  })
    .addOperation(contract.call('resolve', xdr.ScVal.scvString(normalized)))
    .setTimeout(30)
    .build();

  let sim: rpc.Api.SimulateTransactionResponse;
  try {
    sim = await raceWithSignal(server.simulateTransaction(tx), options.signal, rpcUrl);
  } catch (cause) {
    if (cause instanceof WraithError) throw cause;
    if (options.signal?.aborted) {
      throw new RPCAbortedError(rpcUrl, { cause: options.signal.reason });
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/wrong\s*network|network\s*passphrase|passphrase\s*mismatch/i.test(message)) {
      throw new WalletWrongNetworkError({
        chain: 'stellar',
        expectedNetwork: networkPassphrase,
        reason: message,
        cause,
      });
    }
    throw new RPCRequestError(rpcUrl, 503, message);
  }

  if (rpc.Api.isSimulationError(sim)) {
    const detail = sim.error ?? 'Unknown simulation error';
    const codeMatch = detail.match(/Error\(Contract,\s*#(\d+)\)/i);
    if (codeMatch) {
      const code = Number(codeMatch[1]);
      if (code === 6) {
        if (options.throwOnNotFound) throw new NameNotFoundError(normalized);
        return null;
      }
      if (code === 2 || code === 3 || code === 4) {
        throw new InvalidNameError(name, detail);
      }
      if (code === 5) {
        throw new InvalidMetaAddressError('', detail);
      }
      throw new ContractRevertError(detail);
    }

    if (/NameNotFound/i.test(detail)) {
      if (options.throwOnNotFound) throw new NameNotFoundError(normalized);
      return null;
    }

    if (/wrong\s*network|network\s*passphrase|passphrase\s*mismatch/i.test(detail)) {
      throw new WalletWrongNetworkError({
        chain: 'stellar',
        expectedNetwork: networkPassphrase,
        reason: detail,
      });
    }

    throw new RPCRequestError(rpcUrl, 502, detail);
  }

  if (!sim.result?.retval) {
    throw new InvalidMetaAddressError('', 'Wraith Names contract returned no result');
  }

  const resolved = parseMetaAddressPayload(sim.result.retval);
  if (resolved === null) {
    if (options.throwOnNotFound) throw new NameNotFoundError(normalized);
    return null;
  }

  if (ttl > 0) {
    NAME_CACHE.set(cacheKey, {
      metaAddress: resolved,
      expiresAt: Date.now() + ttl,
    });
  }

  return resolved;
}

/** Clears the in-memory Stellar Wraith Names resolution cache. */
export function clearStellarNameCache(): void {
  NAME_CACHE.clear();
}

/** Returns the default in-memory cache TTL (in milliseconds) for {@link resolveStellarName}. */
export function getStellarNameDefaultTtl(): number {
  return defaultTtlMs;
}

/** Sets the default in-memory cache TTL (in milliseconds) for {@link resolveStellarName}. */
export function setStellarNameDefaultTtl(ttlMs: number): void {
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new RangeError(`Expected a non-negative TTL in milliseconds, got ${ttlMs}`);
  }
  defaultTtlMs = ttlMs;
}
