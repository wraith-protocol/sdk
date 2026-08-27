import { RPCRequestError, RPCRetryExhaustedError } from '../../errors';

/** HTTP statuses that trigger a retry by default. */
const DEFAULT_RETRYABLE_STATUSES = [429, 500, 502, 503, 504];

export interface RetryPolicy {
  /** Maximum number of retry attempts (excludes the initial request). Default: 5. */
  maxRetries: number;
  /** Base delay in ms for exponential backoff. Default: 1000. */
  baseDelayMs: number;
  /** Maximum delay in ms (caps exponential growth). Default: 30000. */
  maxDelayMs: number;
  /** HTTP status codes that are considered retryable. */
  retryableStatuses: number[];
}

export interface HorizonClientConfig {
  /** Base Horizon URL, e.g. `https://horizon-testnet.stellar.org`. */
  horizonUrl: string;
  /** Optional retry policy overrides. */
  retry?: Partial<RetryPolicy>;
  /** Optional custom fetch implementation (for testing). */
  fetchImpl?: typeof fetch;
}

export interface HorizonClient {
  /** Perform a GET request to the given path. */
  get<T = unknown>(path: string, overrides?: { retry?: Partial<RetryPolicy> }): Promise<T>;
  /** Perform a POST request to the given path. */
  post<T = unknown>(
    path: string,
    body: URLSearchParams | string,
    overrides?: { retry?: Partial<RetryPolicy> },
  ): Promise<T>;
}

function resolveRetryPolicy(overrides?: Partial<RetryPolicy>): RetryPolicy {
  const defaults: RetryPolicy = {
    maxRetries: 5,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    retryableStatuses: [...DEFAULT_RETRYABLE_STATUSES],
  };
  if (!overrides) return defaults;
  return {
    ...defaults,
    ...overrides,
    retryableStatuses: overrides.retryableStatuses ?? defaults.retryableStatuses,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(response: Response): number | null {
  const val = response.headers.get('Retry-After');
  if (!val) return null;
  const seconds = parseInt(val, 10);
  if (!isNaN(seconds) && seconds >= 0) return seconds * 1000;
  const parsed = Date.parse(val);
  if (!isNaN(parsed)) return Math.max(0, parsed - Date.now());
  return null;
}

function jitter(delay: number): number {
  return Math.round(delay * (0.5 + Math.random() * 0.5));
}

function calculateDelay(attempt: number, policy: RetryPolicy, response?: Response): number {
  if (response) {
    const retryAfter = parseRetryAfter(response);
    if (retryAfter !== null) return Math.min(retryAfter, policy.maxDelayMs);
  }
  const exponential = policy.baseDelayMs * 2 ** attempt;
  return jitter(Math.min(exponential, policy.maxDelayMs));
}

export function createHorizonClient(config: HorizonClientConfig): HorizonClient {
  const baseUrl = config.horizonUrl.replace(/\/$/, '');
  const defaultPolicy = resolveRetryPolicy(config.retry);
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;

  async function request<T>(
    method: string,
    path: string,
    body?: URLSearchParams | string,
    overrides?: { retry?: Partial<RetryPolicy> },
  ): Promise<T> {
    const policy = resolveRetryPolicy({ ...defaultPolicy, ...overrides?.retry });
    const url = `${baseUrl}${path}`;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
      try {
        const init: RequestInit = {
          method,
          headers:
            body instanceof URLSearchParams
              ? { 'Content-Type': 'application/x-www-form-urlencoded' }
              : undefined,
          ...(body ? { body } : {}),
        };

        const response = await fetchImpl(url, init);

        if (response.ok) {
          return (await response.json()) as T;
        }

        if (policy.retryableStatuses.includes(response.status)) {
          if (policy.maxRetries > 0 && attempt < policy.maxRetries) {
            const delay = calculateDelay(attempt, policy, response);
            lastError = new RPCRequestError(url, response.status);
            await sleep(delay);
            continue;
          }
          if (policy.maxRetries > 0) {
            throw new RPCRetryExhaustedError(url, policy.maxRetries, `HTTP ${response.status}`);
          }
        }

        const data = await response.json().catch(() => ({}));
        throw new RPCRequestError(url, response.status, JSON.stringify(data));
      } catch (err) {
        if (err instanceof RPCRequestError) throw err;

        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < policy.maxRetries) {
          const delay = calculateDelay(attempt, policy);
          await sleep(delay);
          continue;
        }
      }
    }

    throw new RPCRetryExhaustedError(url, policy.maxRetries, lastError?.message);
  }

  return {
    get<T>(path: string, overrides?: { retry?: Partial<RetryPolicy> }): Promise<T> {
      return request<T>('GET', path, undefined, overrides);
    },
    post<T>(
      path: string,
      body: URLSearchParams | string,
      overrides?: { retry?: Partial<RetryPolicy> },
    ): Promise<T> {
      return request<T>('POST', path, body, overrides);
    },
  };
}
