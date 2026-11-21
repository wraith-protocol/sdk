import type { MatchedAnnouncement } from './unified';
import {
  createScanAbortError,
  isScannerWorkerResponse,
  type ScannerWorkerFailure,
  type ScannerWorkerInput,
  type ScannerWorkerProgress,
  type ScannerWorkerRequest,
} from './worker-protocol';

/**
 * Minimal Web Worker surface used by {@link createWorkerScanner}.
 *
 * A browser `Worker` satisfies this interface. Keeping it structural lets a
 * test or a custom transport stand in without importing the DOM worker type.
 */
export interface ScannerWorkerEndpoint {
  postMessage(message: ScannerWorkerRequest): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
    options?: EventListenerOptions | boolean,
  ): void;
  terminate?(): void;
}

/**
 * Options for {@link createWorkerScanner}.
 */
export interface WorkerScannerOptions {
  /**
   * Calls `terminate()` on the worker when {@link WorkerScanner.dispose} runs.
   * Defaults to false because the caller usually owns the worker lifetime.
   */
  terminateOnDispose?: boolean;
}

/**
 * Per-scan options for {@link WorkerScanner.scan}.
 */
export interface WorkerScanOptions {
  /** Aborts the scan and asks the worker to release its iterators. */
  signal?: AbortSignal;
  /** Receives progress snapshots posted by the worker. */
  onProgress?: (progress: ScannerWorkerProgress) => void;
}

/**
 * Main-thread handle for a scanner worker.
 */
export interface WorkerScanner {
  /**
   * Starts a scan and resolves with ordered matches.
   *
   * Order is EVM, Stellar, Solana, CKB, then the announcement or cell order in
   * the input. Rejects with `ScannerWorkerError` for typed worker failures and
   * with an `AbortError` when `signal` aborts.
   */
  scan(input: ScannerWorkerInput, options?: WorkerScanOptions): Promise<MatchedAnnouncement[]>;
  /** Sends a cancel request for a specific scan id. */
  cancel(requestId: string): void;
  /** Rejects pending scans, removes listeners and optionally terminates. */
  dispose(): void;
  /** Number of scans waiting for a result. */
  readonly pendingCount: number;
}

/**
 * Error raised when the worker reports a typed failure.
 */
export class ScannerWorkerError extends Error {
  /** Stable failure code from the worker protocol. */
  readonly code: ScannerWorkerFailure['code'];
  /** Request id the failure belongs to. */
  readonly requestId: string;
  /** Chain that failed, when the worker supplied one. */
  readonly chain?: ScannerWorkerFailure['chain'];
  /** Full serializable failure payload. */
  readonly failure: ScannerWorkerFailure;

  constructor(failure: ScannerWorkerFailure, requestId: string) {
    super(failure.message);
    this.name = 'ScannerWorkerError';
    this.code = failure.code;
    this.requestId = requestId;
    this.chain = failure.chain;
    this.failure = failure;
  }
}

interface PendingScan {
  resolve: (matches: MatchedAnnouncement[]) => void;
  reject: (error: unknown) => void;
  onProgress?: (progress: ScannerWorkerProgress) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
}

let requestCounter = 0;

function createRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  requestCounter += 1;
  return `scan-${requestCounter.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown worker error';
}

/**
 * Wraps a Web Worker in a typed scanner client.
 *
 * The client speaks the versioned message schema from
 * `@wraith-protocol/sdk/scanner/worker`, so the host never has to handle raw
 * `message` events or reconstruct error state by hand.
 */
export function createWorkerScanner(
  endpoint: ScannerWorkerEndpoint,
  options: WorkerScannerOptions = {},
): WorkerScanner {
  const pendingScans = new Map<string, PendingScan>();
  let disposed = false;

  const settle = (requestId: string): PendingScan | undefined => {
    const pending = pendingScans.get(requestId);
    if (!pending) return undefined;
    pendingScans.delete(requestId);
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener('abort', pending.abortListener);
    }
    return pending;
  };

  const onMessage = (event: MessageEvent<unknown>): void => {
    const response = event.data;
    if (!isScannerWorkerResponse(response)) return;

    const pending = pendingScans.get(response.requestId);
    if (!pending) return;

    if (response.type === 'progress') {
      try {
        pending.onProgress?.(response.progress);
      } catch {
        // A host progress callback must not break result delivery.
      }
      return;
    }

    settle(response.requestId);

    if (response.type === 'result') {
      pending.resolve(response.matches);
      return;
    }

    if (response.failure.code === 'cancelled' && pending.signal?.aborted) {
      pending.reject(createScanAbortError());
    } else {
      pending.reject(new ScannerWorkerError(response.failure, response.requestId));
    }
  };

  endpoint.addEventListener('message', onMessage);

  const failPending = (message: string): void => {
    for (const [requestId, pending] of Array.from(pendingScans.entries())) {
      settle(requestId);
      pending.reject(new ScannerWorkerError({ code: 'disposed', message }, requestId));
    }
  };

  return {
    scan(input, scanOptions = {}) {
      return new Promise<MatchedAnnouncement[]>((resolve, reject) => {
        if (disposed) {
          reject(
            new ScannerWorkerError(
              { code: 'disposed', message: 'Worker scanner has been disposed' },
              'unknown',
            ),
          );
          return;
        }

        if (scanOptions.signal?.aborted) {
          reject(createScanAbortError());
          return;
        }

        const requestId = createRequestId();
        const pending: PendingScan = {
          resolve,
          reject,
          onProgress: scanOptions.onProgress,
          signal: scanOptions.signal,
        };

        if (scanOptions.signal) {
          pending.abortListener = (): void => {
            try {
              endpoint.postMessage({ type: 'cancel', requestId });
            } catch {
              // The worker may already be gone; the rejection below still applies.
            }
            settle(requestId);
            reject(createScanAbortError());
          };
          scanOptions.signal.addEventListener('abort', pending.abortListener, { once: true });
        }

        pendingScans.set(requestId, pending);

        try {
          endpoint.postMessage({ type: 'start', requestId, input });
        } catch (error) {
          settle(requestId);
          reject(
            new ScannerWorkerError(
              { code: 'scan-failed', message: getErrorMessage(error) },
              requestId,
            ),
          );
        }
      });
    },

    cancel(requestId) {
      if (disposed) return;
      try {
        endpoint.postMessage({ type: 'cancel', requestId });
      } catch {
        // Nothing to do: a worker that cannot receive cancel is already gone.
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      endpoint.removeEventListener('message', onMessage);
      failPending('Worker scanner has been disposed');
      if (options.terminateOnDispose) endpoint.terminate?.();
    },

    get pendingCount() {
      return pendingScans.size;
    },
  };
}
