import { RPCRequestError, RPCRetryExhaustedError } from '../../errors';

export interface RpcEndpoint {
  url: string;
}

export interface RpcClientConfig {
  endpoints: RpcEndpoint[];
  healthCheckPath?: string;
  circuitBreaker?: {
    failureThreshold: number;
    cooldownMs: number;
  };
  retry?: {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  fetchImpl?: typeof fetch;
}

export interface RpcClient {
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  getHealthyEndpoint(): string;
  on(
    event: 'endpointFailover',
    listener: (detail: { from: string; to: string; reason: string }) => void,
  ): void;
  off(
    event: 'endpointFailover',
    listener: (detail: { from: string; to: string; reason: string }) => void,
  ): void;
}

interface EndpointState {
  url: string;
  healthy: boolean;
  consecutiveFailures: number;
  cooldownUntil: number;
}

const DEFAULT_RETRYABLE_STATUSES = [429, 500, 502, 503, 504];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = baseDelayMs * 2 ** attempt;
  return Math.round(Math.min(exponential, maxDelayMs) * (0.5 + Math.random() * 0.5));
}

export function createRpcClient(config: RpcClientConfig): RpcClient {
  if (!config.endpoints || config.endpoints.length === 0) {
    throw new Error('At least one RPC endpoint is required');
  }

  const healthCheckPath = config.healthCheckPath ?? '/';
  const failureThreshold = config.circuitBreaker?.failureThreshold ?? 3;
  const cooldownMs = config.circuitBreaker?.cooldownMs ?? 30_000;
  const maxRetries = config.retry?.maxRetries ?? 2;
  const baseDelayMs = config.retry?.baseDelayMs ?? 500;
  const maxDelayMs = config.retry?.maxDelayMs ?? 10_000;
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;

  const states: EndpointState[] = config.endpoints.map((ep) => ({
    url: ep.url,
    healthy: true,
    consecutiveFailures: 0,
    cooldownUntil: 0,
  }));

  type FailoverListener = (detail: { from: string; to: string; reason: string }) => void;
  const failoverListeners: Set<FailoverListener> = new Set();

  let currentIndex = 0;

  function getHealthyEndpoint(): string {
    return states[currentIndex].url;
  }

  function emitFailover(from: string, to: string, reason: string): void {
    for (const listener of failoverListeners) {
      listener({ from, to, reason });
    }
  }

  function markUnhealthy(state: EndpointState): void {
    state.healthy = false;
    state.consecutiveFailures = 0;
    state.cooldownUntil = Date.now() + cooldownMs;
  }

  function markHealthy(state: EndpointState): void {
    state.healthy = true;
    state.consecutiveFailures = 0;
    state.cooldownUntil = 0;
  }

  function findNextHealthy(currentUrl: string): number | null {
    for (let offset = 1; offset < states.length; offset++) {
      const idx = (currentIndex + offset) % states.length;
      const state = states[idx];
      const now = Date.now();
      if (state.healthy || now >= state.cooldownUntil) {
        return idx;
      }
    }
    for (let i = 0; i < states.length; i++) {
      if (states[i].url !== currentUrl) {
        states[i].healthy = true;
        states[i].consecutiveFailures = 0;
        states[i].cooldownUntil = 0;
        return i;
      }
    }
    return null;
  }

  function attemptFailover(reason: string): boolean {
    const fromUrl = states[currentIndex].url;
    const nextIdx = findNextHealthy(fromUrl);
    if (nextIdx === null) return false;
    const toUrl = states[nextIdx].url;
    currentIndex = nextIdx;
    emitFailover(fromUrl, toUrl, reason);
    return true;
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    // Each endpoint needs at least `failureThreshold` attempts for the circuit
    // breaker to trip and trigger failover — otherwise a low maxRetries could
    // exhaust the loop before failover is ever reachable.
    const maxAttemptsPerEndpoint = Math.max(maxRetries + 1, failureThreshold);
    const maxAttempts = states.length * maxAttemptsPerEndpoint;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const state = states[currentIndex];
      const now = Date.now();

      if (!state.healthy && now < state.cooldownUntil) {
        const failed = attemptFailover(
          `Endpoint ${state.url} is in cooldown (${Math.ceil((state.cooldownUntil - now) / 1000)}s remaining)`,
        );
        if (!failed) {
          throw new RPCRetryExhaustedError(state.url, maxAttempts, 'All endpoints are in cooldown');
        }
        continue;
      }

      if (!state.healthy && now >= state.cooldownUntil) {
        markHealthy(state);
      }

      const url = `${state.url.replace(/\/$/, '')}${path}`;

      try {
        const init: RequestInit = { method };
        if (body !== undefined) {
          init.headers = { 'Content-Type': 'application/json' };
          init.body = JSON.stringify(body);
        }

        const response = await fetchImpl(url, init);

        if (response.ok) {
          markHealthy(state);
          return (await response.json()) as T;
        }

        if (DEFAULT_RETRYABLE_STATUSES.includes(response.status)) {
          state.consecutiveFailures++;
          if (state.consecutiveFailures >= failureThreshold) {
            markUnhealthy(state);
            const failed = attemptFailover(
              `HTTP ${response.status} on ${state.url} (${state.consecutiveFailures} consecutive failures)`,
            );
            if (!failed) {
              throw new RPCRetryExhaustedError(
                state.url,
                maxAttempts,
                `All endpoints exhausted after HTTP ${response.status}`,
              );
            }
            continue;
          }
          lastError = new RPCRequestError(url, response.status);
          const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs);
          await sleep(delay);
          continue;
        }

        const data = await response.json().catch(() => ({}));
        throw new RPCRequestError(url, response.status, JSON.stringify(data));
      } catch (err) {
        if (
          err instanceof RPCRequestError &&
          !DEFAULT_RETRYABLE_STATUSES.includes(err.statusCode)
        ) {
          throw err;
        }

        if (err instanceof RPCRetryExhaustedError) {
          throw err;
        }

        state.consecutiveFailures++;
        lastError = err instanceof Error ? err : new Error(String(err));

        if (state.consecutiveFailures >= failureThreshold) {
          markUnhealthy(state);
          const failed = attemptFailover(`Network error on ${state.url}: ${lastError.message}`);
          if (!failed) {
            throw new RPCRetryExhaustedError(
              state.url,
              maxAttempts,
              `All endpoints exhausted: ${lastError.message}`,
            );
          }
          continue;
        }

        const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs);
        await sleep(delay);
      }
    }

    throw new RPCRetryExhaustedError(states[currentIndex].url, maxAttempts, lastError?.message);
  }

  return {
    request,
    getHealthyEndpoint,
    on(event: 'endpointFailover', listener: FailoverListener): void {
      if (event === 'endpointFailover') {
        failoverListeners.add(listener);
      }
    },
    off(event: 'endpointFailover', listener: FailoverListener): void {
      if (event === 'endpointFailover') {
        failoverListeners.delete(listener);
      }
    },
  };
}
