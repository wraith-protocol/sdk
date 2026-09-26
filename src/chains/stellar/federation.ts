import { StrKey } from '@stellar/stellar-sdk';

/**
 * Default cache TTL (1 hour) for resolved federation addresses.
 *
 * @see {@link setFederationDefaultTtl}
 */
export const DEFAULT_FEDERATION_TTL_MS = 60 * 60 * 1000;

/** Default per-request timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** SEP-0001 well-known stellar.toml path. */
const STELLAR_TOML_PATH = '/.well-known/stellar.toml';

/**
 * Validates the structural form of a federation address (`name*domain.tld`).
 *
 * The Stellar Federation spec (SEP-0002) allows alphanumerics, dots, dashes,
 * underscores, and `+` in the `name`; the domain must contain at least one dot.
 */
const FEDERATION_REGEX = /^[A-Za-z0-9._+\-]+\*[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

/** Supported Stellar memo types as per SEP-0002. */
export type FederationMemoType = 'text' | 'id' | 'hash';

/** Memo specified by a federation server for a resolved address. */
export interface FederationMemo {
  /** Memo type — one of `text`, `id`, or `hash`. */
  type: FederationMemoType;
  /** Memo value (text payload, integer string, or hex hash). */
  value: string;
}

/** Typed result returned by {@link resolveStellarFederation}. */
export interface FederationResolution {
  /** Stellar account ID (G...) the federation address resolves to. */
  accountId: string;
  /** The federation address as reported by the server (or the original input). */
  stellarAddress: string;
  /** Optional memo specified by the federation server. */
  memo?: FederationMemo;
  /** Unix milliseconds when the resolution was produced. */
  resolvedAt: number;
}

/** Discriminator for {@link FederationResolutionError} consumers. */
export type FederationErrorCode =
  | 'INVALID_ADDRESS'
  | 'TOML_FETCH_FAILED'
  | 'FEDERATION_SERVER_MISSING'
  | 'FEDERATION_SERVER_FAILED'
  | 'INVALID_RESPONSE'
  | 'TIMEOUT'
  | 'INSECURE_PROTOCOL';

/**
 * Decoded error thrown by {@link resolveStellarFederation} whenever a lookup
 * cannot be completed. The `code` field categorises the failure for
 * programmatic handling; the `message` is a human-readable explanation.
 */
export class FederationResolutionError extends Error {
  readonly code: FederationErrorCode;

  constructor(code: FederationErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'FederationResolutionError';
    this.code = code;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/** Per-call configuration for {@link resolveStellarFederation}. */
export interface ResolveFederationOptions {
  /**
   * Cache TTL in milliseconds for this resolution. Defaults to the value set
   * by {@link setFederationDefaultTtl} (1 hour at module load). Use `0` to
   * skip writing this entry to the cache.
   */
  cacheTtlMs?: number;
  /** Bypass any cached entry for this call (and skip writing the result). */
  noCache?: boolean;
  /** Custom fetch implementation — useful for tests, proxies, or RN polyfills. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in milliseconds. Default `10_000`. */
  timeoutMs?: number;
  /**
   * Allow http:// URLs. SEP-0001 requires HTTPS, so by default any
   * `FEDERATION_SERVER` that uses http will be rejected. Only set this to
   * `true` for testing against local servers.
   */
  allowInsecureHttp?: boolean;
}

interface CacheEntry {
  expiresAt: number;
  resolution: FederationResolution;
}

const cache = new Map<string, CacheEntry>();
let defaultTtlMs = DEFAULT_FEDERATION_TTL_MS;

/**
 * Resolve a Stellar federation address (SEP-0002, `name*domain.com`) into a
 * Stellar account ID and optional memo.
 *
 * Resolution flow:
 * 1. Validates the input shape. Already-encoded `G...` and `M...` account IDs
 *    are passed through unchanged.
 * 2. Fetches `https://<domain>/.well-known/stellar.toml` (SEP-0001) and
 *    extracts `FEDERATION_SERVER`.
 * 3. Queries `<FEDERATION_SERVER>?q=<address>&type=name`.
 * 4. Validates the response (account_id strkey, optional memo) and caches it.
 *
 * Results are cached in-memory by address for the configured TTL (default
 * 1 hour). Call {@link clearFederationCache} to drop cached entries or
 * {@link setFederationDefaultTtl} to change the default.
 *
 * @param input   Federation address (`name*domain.com`) or a Stellar account
 *                ID (`G...` or `M...`), which is returned without a network
 *                round-trip.
 * @param options Per-call cache / fetch / timeout overrides.
 * @throws {FederationResolutionError} If lookup fails at any step.
 *
 * @example
 * ```ts
 * import { resolveStellarFederation } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const { accountId, memo } = await resolveStellarFederation('alice*example.com');
 * if (memo) console.log(`Send with memo ${memo.type}=${memo.value}`);
 * ```
 */
export async function resolveStellarFederation(
  input: string,
  options: ResolveFederationOptions = {},
): Promise<FederationResolution> {
  const address = typeof input === 'string' ? input.trim() : '';
  if (!address) {
    throw new FederationResolutionError('INVALID_ADDRESS', 'federation address is empty');
  }

  if (isStellarAccountId(address)) {
    return {
      accountId: address,
      stellarAddress: address,
      resolvedAt: Date.now(),
    };
  }

  if (!FEDERATION_REGEX.test(address)) {
    throw new FederationResolutionError(
      'INVALID_ADDRESS',
      `not a valid federation address: "${address}". Expected "name*domain.tld".`,
    );
  }

  const noCache = options.noCache === true;
  if (!noCache) {
    const cached = readCache(address);
    if (cached) return cached;
  }

  const domain = address.split('*')[1];
  const resolution = await performResolution(address, domain, options);

  if (!noCache) {
    const ttl = options.cacheTtlMs ?? defaultTtlMs;
    if (ttl > 0) {
      cache.set(address, { resolution, expiresAt: Date.now() + ttl });
    }
  }

  return resolution;
}

/**
 * Clear cached federation resolutions.
 *
 * @param address Optional federation address to evict. When omitted, the
 *                entire cache is cleared.
 */
export function clearFederationCache(address?: string): void {
  if (address) cache.delete(address);
  else cache.clear();
}

/**
 * Change the default TTL applied to newly cached federation resolutions.
 * Existing entries keep their original expiry.
 *
 * @param ttlMs A non-negative finite number of milliseconds. `0` disables
 *              caching for subsequent resolutions that don't override the TTL.
 */
export function setFederationDefaultTtl(ttlMs: number): void {
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new Error('ttlMs must be a non-negative finite number');
  }
  defaultTtlMs = ttlMs;
}

/** Returns the current default cache TTL in milliseconds. */
export function getFederationDefaultTtl(): number {
  return defaultTtlMs;
}

async function performResolution(
  address: string,
  domain: string,
  options: ResolveFederationOptions,
): Promise<FederationResolution> {
  const tomlUrl = `https://${domain}${STELLAR_TOML_PATH}`;
  const tomlText = await fetchText(tomlUrl, options, 'TOML_FETCH_FAILED');
  const federationServer = parseFederationServer(tomlText);

  if (!federationServer) {
    throw new FederationResolutionError(
      'FEDERATION_SERVER_MISSING',
      `${domain} stellar.toml does not define FEDERATION_SERVER`,
    );
  }
  if (!/^https?:\/\//i.test(federationServer)) {
    throw new FederationResolutionError(
      'INVALID_RESPONSE',
      `FEDERATION_SERVER is not a valid URL: ${federationServer}`,
    );
  }
  if (/^http:\/\//i.test(federationServer) && options.allowInsecureHttp !== true) {
    throw new FederationResolutionError(
      'INSECURE_PROTOCOL',
      `FEDERATION_SERVER must use HTTPS: ${federationServer}`,
    );
  }

  const sep = federationServer.includes('?') ? '&' : '?';
  const queryUrl = `${federationServer}${sep}q=${encodeURIComponent(address)}&type=name`;
  const text = await fetchText(queryUrl, options, 'FEDERATION_SERVER_FAILED');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new FederationResolutionError(
      'INVALID_RESPONSE',
      `federation server response is not JSON: ${text.slice(0, 120)}`,
      err,
    );
  }

  return shapeResponse(parsed, address);
}

function shapeResponse(parsed: unknown, address: string): FederationResolution {
  if (!parsed || typeof parsed !== 'object') {
    throw new FederationResolutionError(
      'INVALID_RESPONSE',
      'federation response is not a JSON object',
    );
  }
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.detail === 'string' && typeof obj.account_id !== 'string') {
    throw new FederationResolutionError(
      'INVALID_RESPONSE',
      `federation server error: ${obj.detail}`,
    );
  }

  const accountId = obj.account_id;
  if (typeof accountId !== 'string' || !isStellarAccountId(accountId)) {
    throw new FederationResolutionError(
      'INVALID_RESPONSE',
      `federation response missing or invalid account_id: ${String(accountId)}`,
    );
  }

  let memo: FederationMemo | undefined;
  if (obj.memo_type !== undefined || obj.memo !== undefined) {
    const type = obj.memo_type;
    const value = obj.memo;
    if (typeof type !== 'string' || (value !== undefined && typeof value !== 'string')) {
      throw new FederationResolutionError(
        'INVALID_RESPONSE',
        'memo_type must be a string and memo must be a string when provided',
      );
    }
    if (type !== 'text' && type !== 'id' && type !== 'hash') {
      throw new FederationResolutionError(
        'INVALID_RESPONSE',
        `unsupported memo_type "${type}". Expected "text", "id", or "hash".`,
      );
    }
    if (typeof value === 'string') {
      memo = { type, value };
    }
  }

  const reported = typeof obj.stellar_address === 'string' ? obj.stellar_address : address;
  return { accountId, stellarAddress: reported, memo, resolvedAt: Date.now() };
}

async function fetchText(
  url: string,
  options: ResolveFederationOptions,
  failureCode: FederationErrorCode,
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new FederationResolutionError(
      failureCode,
      'no global fetch available — pass options.fetchImpl',
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json, text/plain, */*' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new FederationResolutionError(
        failureCode,
        `request failed: ${res.status} ${res.statusText || ''} (${url})`.trim(),
      );
    }
    return await res.text();
  } catch (err) {
    if (err instanceof FederationResolutionError) throw err;
    const name = (err as { name?: string } | null)?.name;
    if (name === 'AbortError' || name === 'TimeoutError') {
      throw new FederationResolutionError(
        'TIMEOUT',
        `request timed out after ${timeoutMs} ms (${url})`,
        err,
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new FederationResolutionError(failureCode, `request error for ${url}: ${message}`, err);
  } finally {
    clearTimeout(timer);
  }
}

function parseFederationServer(toml: string): string | null {
  const match = toml.match(/^\s*FEDERATION_SERVER\s*=\s*(?:"([^"]+)"|'([^']+)')/m);
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

function readCache(address: string): FederationResolution | null {
  const entry = cache.get(address);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(address);
    return null;
  }
  return entry.resolution;
}

function isStellarAccountId(value: string): boolean {
  if (StrKey.isValidEd25519PublicKey(value)) return true;
  const muxed = (StrKey as unknown as { isValidMed25519PublicKey?: (v: string) => boolean })
    .isValidMed25519PublicKey;
  if (typeof muxed === 'function' && muxed(value)) return true;
  return false;
}
