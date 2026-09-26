import { RPCTimeoutError, type RPCTimeoutPhase } from '../../errors';

/**
 * Per-attempt timeouts for the Horizon and Soroban RPC clients.
 *
 * `fetch()` has no separate hook for the TCP/TLS handshake, so `connectMs` covers everything up
 * to the response headers: DNS lookup, connecting, sending the request and waiting for the
 * endpoint to start answering. `requestMs` bounds the whole attempt, reading the body included.
 *
 * Each retry and each failover attempt gets a fresh budget. Set either value to `0` to turn
 * that timeout off.
 */
export interface RequestTimeouts {
  /**
   * Milliseconds to wait for the response headers.
   * @defaultValue 10000
   */
  connectMs?: number;
  /**
   * Milliseconds allowed for the whole attempt, including reading the response body.
   * @defaultValue 30000
   */
  requestMs?: number;
}

type ResolvedTimeouts = Required<RequestTimeouts>;

const DEFAULT_TIMEOUTS: ResolvedTimeouts = { connectMs: 10_000, requestMs: 30_000 };

/** Largest delay `setTimeout` honours; anything bigger overflows and fires at once. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Merges timeout layers over the defaults, later layers winning. Throws a `RangeError` for a
 * value that is not a number of milliseconds `setTimeout` can wait for.
 */
export function resolveTimeouts(...layers: Array<RequestTimeouts | undefined>): ResolvedTimeouts {
  const resolved = { ...DEFAULT_TIMEOUTS };
  for (const layer of layers) {
    for (const key of ['connectMs', 'requestMs'] as const) {
      const value = layer?.[key];
      if (value === undefined) continue;
      if (typeof value !== 'number' || !(value >= 0 && value <= MAX_TIMEOUT_MS)) {
        throw new RangeError(
          `timeouts.${key} must be between 0 and ${MAX_TIMEOUT_MS} milliseconds, got ${String(value)}`,
        );
      }
      resolved[key] = value;
    }
  }
  return resolved;
}

/** Where an attempt was sent, reported on the timeout error if it expires. */
interface AttemptTarget {
  url: string;
  endpoint: string;
  attempt: number;
}

/**
 * The deadline for one HTTP attempt. It owns the `AbortSignal` passed to `fetch()`, aborts it
 * when a timeout fires, and races the fetch and body-read promises against the deadline, so a
 * `fetch` implementation that ignores the signal still cannot hang the attempt.
 *
 * Callers must call {@link AttemptDeadline.dispose} once the attempt is settled, before any
 * backoff sleep, so no timer outlives the attempt.
 */
export class AttemptDeadline {
  private readonly controller =
    typeof AbortController === 'function' ? new AbortController() : undefined;
  private readonly expiry: Promise<never>;
  private rejectExpiry!: (error: RPCTimeoutError) => void;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private requestTimer: ReturnType<typeof setTimeout> | undefined;
  private timeoutError: RPCTimeoutError | undefined;

  constructor(
    timeouts: ResolvedTimeouts,
    private readonly target: AttemptTarget,
  ) {
    this.expiry = new Promise<never>((_, reject) => {
      this.rejectExpiry = reject;
    });
    // The expiry can reject while nothing is racing it; that must not be an unhandled rejection.
    this.expiry.catch(() => undefined);

    const { connectMs, requestMs } = timeouts;
    if (connectMs > 0) {
      this.connectTimer = setTimeout(() => this.expire('connect', connectMs), connectMs);
    }
    if (requestMs > 0) {
      this.requestTimer = setTimeout(() => this.expire('request', requestMs), requestMs);
    }
  }

  /** Calls `fetchImpl` with this attempt's abort signal and resolves once the headers arrive. */
  async send(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
    const signal = this.controller?.signal;
    const response = await this.race(() => fetchImpl(url, signal ? { ...init, signal } : init));
    clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
    return response;
  }

  /** Waits for a body read, such as `response.json()`, within the request timeout. */
  read<T>(body: Promise<T>): Promise<T> {
    return this.race(() => body);
  }

  /** Clears the timers. Safe to call more than once. */
  dispose(): void {
    clearTimeout(this.connectTimer);
    clearTimeout(this.requestTimer);
    this.connectTimer = undefined;
    this.requestTimer = undefined;
  }

  private async race<T>(start: () => Promise<T>): Promise<T> {
    try {
      return await Promise.race([start(), this.expiry]);
    } catch (err) {
      // An aborted fetch rejects with whatever its implementation picks, usually a DOMException
      // named `AbortError`. Report the timeout that caused the abort instead.
      throw this.timeoutError ?? err;
    }
  }

  private expire(phase: RPCTimeoutPhase, timeoutMs: number): void {
    this.dispose();
    const error = new RPCTimeoutError({ ...this.target, phase, timeoutMs });
    this.timeoutError = error;
    this.rejectExpiry(error);
    this.controller?.abort(error);
  }
}
