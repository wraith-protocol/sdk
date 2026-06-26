/**
 * Stellar Federation Address Resolution (SEP-0002)
 *
 * Resolves human-readable federation addresses (`name*domain.com`) to Stellar
 * account IDs and optional memos via the two-step TOML → federation-server
 * lookup defined in SEP-0002.
 *
 * Resolution results are cached in-memory (default TTL: 1 hour). Pass a custom
 * `cacheTtl` or `fetch` to the {@link FederationResolver} constructor when you
 * need a different policy or want to inject a mock in tests.
 *
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0002.md
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FederationMemoType = 'text' | 'id' | 'hash';

/** Resolved Stellar federation address. */
export interface FederationResult {
  /** The Stellar account ID (`G…`). */
  accountId: string;
  /**
   * Optional memo to attach to payments sent to this address.
   * Only present when the federation server returned both `memo_type` and `memo`.
   */
  memo?: { type: FederationMemoType; value: string };
}

/** Discriminated error codes for federation resolution failures. */
export type FederationErrorCode =
  | 'INVALID_ADDRESS'
  | 'TOML_FETCH_FAILED'
  | 'TOML_PARSE_FAILED'
  | 'NO_FEDERATION_SERVER'
  | 'FEDERATION_FETCH_FAILED'
  | 'NOT_FOUND'
  | 'INVALID_RESPONSE';

export class FederationError extends Error {
  readonly code: FederationErrorCode;

  constructor(code: FederationErrorCode, message: string) {
    super(message);
    this.name = 'FederationError';
    this.code = code;
  }
}

/** Minimal fetch signature accepted by {@link FederationResolver}. */
export type FederationFetchFn = (url: string) => Promise<Response>;

export interface FederationResolverOptions {
  /**
   * Cache TTL in milliseconds. Defaults to `3_600_000` (1 hour).
   * Set to `0` to disable caching.
   */
  cacheTtl?: number;
  /**
   * Custom fetch function. Defaults to `globalThis.fetch`.
   * Inject a mock here in unit tests.
   */
  fetch?: FederationFetchFn;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

interface CacheEntry {
  result: FederationResult;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 3_600_000;
const MEMO_TYPES = new Set<string>(['text', 'id', 'hash']);
// name must not contain `*` or whitespace; domain must contain a dot
const FED_ADDRESS_RE = /^[^*\s]+\*[^*\s]+\.[^*\s]+$/;

/**
 * Stateful resolver with its own in-memory cache. Prefer this class when you
 * need isolated cache scopes, non-default TTLs, or a mock fetch in tests.
 *
 * For most callers, use the module-level {@link resolveStellarFederation} instead.
 *
 * **Caching:** Resolved results are stored until `expiresAt = Date.now() + cacheTtl`.
 * Use {@link invalidate} to drop a single entry or {@link clear} to flush all entries.
 */
export class FederationResolver {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttl: number;
  private readonly fetchFn: FederationFetchFn;

  constructor(options: FederationResolverOptions = {}) {
    this.ttl = options.cacheTtl ?? DEFAULT_TTL_MS;
    this.fetchFn = options.fetch ?? ((url) => globalThis.fetch(url));
  }

  /**
   * Resolves `address` (`name*domain.com`) to a {@link FederationResult}.
   *
   * Flow:
   * 1. Validate address format.
   * 2. Return cached result if still fresh.
   * 3. Fetch `https://<domain>/.well-known/stellar.toml` and extract `FEDERATION_SERVER`.
   * 4. Query `<FEDERATION_SERVER>?q=<address>&type=name`.
   * 5. Parse JSON, cache, and return.
   *
   * @throws {@link FederationError} on any failure (see `code` for the reason).
   */
  async resolve(address: string): Promise<FederationResult> {
    const normalised = address.trim().toLowerCase();

    if (!FED_ADDRESS_RE.test(normalised)) {
      throw new FederationError('INVALID_ADDRESS', `Not a valid federation address: "${address}"`);
    }

    if (this.ttl > 0) {
      const cached = this.cache.get(normalised);
      if (cached && Date.now() < cached.expiresAt) return cached.result;
    }

    const domain = normalised.slice(normalised.indexOf('*') + 1);
    const federationUrl = await this.resolveFederationServer(domain);
    // Use the normalised (lowercase) address for the query so cache keying and
    // federation server lookups are consistent regardless of caller casing.
    const result = await this.queryFederationServer(federationUrl, normalised);

    if (this.ttl > 0) {
      this.cache.set(normalised, { result, expiresAt: Date.now() + this.ttl });
    }
    return result;
  }

  /** Drops the cached entry for `address` so the next call re-fetches. */
  invalidate(address: string): void {
    this.cache.delete(address.trim().toLowerCase());
  }

  /** Clears all cached entries. */
  clear(): void {
    this.cache.clear();
  }

  // -------------------------------------------------------------------------

  private async resolveFederationServer(domain: string): Promise<string> {
    const tomlUrl = `https://${domain}/.well-known/stellar.toml`;
    let tomlText: string;
    try {
      const resp = await this.fetchFn(tomlUrl);
      if (!resp.ok) {
        throw new FederationError(
          'TOML_FETCH_FAILED',
          `stellar.toml returned HTTP ${resp.status} for domain "${domain}"`,
        );
      }
      tomlText = await resp.text();
    } catch (err) {
      if (err instanceof FederationError) throw err;
      throw new FederationError(
        'TOML_FETCH_FAILED',
        `Failed to fetch stellar.toml from "${domain}": ${(err as Error).message}`,
      );
    }
    return parseFederationServerUrl(tomlText, domain);
  }

  private async queryFederationServer(
    federationUrl: string,
    address: string,
  ): Promise<FederationResult> {
    // Append query params whether or not the URL already has a query string.
    // encodeURIComponent leaves `*` unencoded; force-encode it so the `name*domain`
    // separator is unambiguous in the query string.
    const encoded = encodeURIComponent(address).replace(/\*/g, '%2A');
    const sep = federationUrl.includes('?') ? '&' : '?';
    const queryUrl = `${federationUrl}${sep}q=${encoded}&type=name`;
    try {
      const resp = await this.fetchFn(queryUrl);
      if (resp.status === 404) {
        throw new FederationError('NOT_FOUND', `Federation address not found: "${address}"`);
      }
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        const detail = tryParseErrorBody(body) ?? `HTTP ${resp.status}`;
        throw new FederationError('FEDERATION_FETCH_FAILED', `Federation server error: ${detail}`);
      }
      const body = await resp.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(body) as Record<string, unknown>;
      } catch {
        throw new FederationError(
          'INVALID_RESPONSE',
          'Federation server returned non-JSON response',
        );
      }
      return parseFederationResponse(data, address);
    } catch (err) {
      if (err instanceof FederationError) throw err;
      throw new FederationError(
        'FEDERATION_FETCH_FAILED',
        `Failed to reach federation server: ${(err as Error).message}`,
      );
    }
  }
}

/** Shared singleton with default 1-hour cache used by {@link resolveStellarFederation}. */
const _defaultResolver = new FederationResolver();

/**
 * Resolves a Stellar federation address (`name*domain.com`) to a Stellar
 * account ID and optional memo, following SEP-0002.
 *
 * Results are cached for 1 hour by default. For custom TTL, mock fetch, or
 * isolated cache scopes, instantiate {@link FederationResolver} directly.
 *
 * @example
 * ```ts
 * const { accountId, memo } = await resolveStellarFederation('alice*example.com');
 * // Send to accountId, attach memo if present
 * ```
 *
 * @throws {@link FederationError} — check `.code` for the failure reason.
 */
export function resolveStellarFederation(address: string): Promise<FederationResult> {
  return _defaultResolver.resolve(address);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseFederationServerUrl(toml: string, domain: string): string {
  // Match both single- and double-quoted values on any line.
  const match = toml.match(/^\s*FEDERATION_SERVER\s*=\s*["']([^"']+)["']/m);
  if (!match) {
    throw new FederationError(
      'NO_FEDERATION_SERVER',
      `stellar.toml for "${domain}" does not define FEDERATION_SERVER`,
    );
  }
  const url = match[1].trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      throw new FederationError(
        'TOML_PARSE_FAILED',
        `FEDERATION_SERVER must use HTTPS, got "${url}"`,
      );
    }
  } catch (err) {
    if (err instanceof FederationError) throw err;
    throw new FederationError(
      'TOML_PARSE_FAILED',
      `FEDERATION_SERVER is not a valid URL: "${url}"`,
    );
  }
  return url;
}

function parseFederationResponse(data: Record<string, unknown>, address: string): FederationResult {
  if (typeof data['account_id'] !== 'string' || !data['account_id']) {
    throw new FederationError(
      'INVALID_RESPONSE',
      `Federation response missing account_id for "${address}"`,
    );
  }
  const result: FederationResult = { accountId: data['account_id'] };

  const memoType = typeof data['memo_type'] === 'string' ? data['memo_type'].toLowerCase() : null;
  const memoValue = typeof data['memo'] === 'string' ? data['memo'] : null;

  if (memoType !== null && memoValue !== null) {
    if (!MEMO_TYPES.has(memoType)) {
      throw new FederationError('INVALID_RESPONSE', `Unknown memo_type "${data['memo_type']}"`);
    }
    result.memo = { type: memoType as FederationMemoType, value: memoValue };
  }

  return result;
}

function tryParseErrorBody(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (typeof parsed['detail'] === 'string') return parsed['detail'];
    if (typeof parsed['message'] === 'string') return parsed['message'];
    if (typeof parsed['error'] === 'string') return parsed['error'];
  } catch {
    // not JSON — fall through
  }
  return body.slice(0, 200) || null;
}
