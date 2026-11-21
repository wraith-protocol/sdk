/**
 * CSP-safe Web Worker entry point for the stealth scanner.
 *
 * The module is designed to be imported by a static worker file:
 *
 * ```ts
 * // scanner.worker.ts (your app)
 * import '@wraith-protocol/sdk/scanner/worker';
 * ```
 *
 * On import inside a worker global scope the message handler installs itself,
 * so the host can create the worker with a normal static URL and no blob
 * wrapper, dynamic code, or bundler-specific transform:
 *
 * ```ts
 * const worker = new Worker(new URL('./scanner.worker.ts', import.meta.url), {
 *   type: 'module',
 * });
 * ```
 *
 * The scanner itself is the same code the main thread uses. Announcements and
 * keys cross the boundary as structured data, so a Content Security Policy
 * that blocks `unsafe-eval` and `blob:` workers does not affect it.
 */

import { isAbortError, getUnknownErrorMessage } from '../chains/errorUtils';
import { runScannerWorker, ScannerWorkerInputError } from './worker-core';
import {
  isScannerWorkerRequest,
  isScannerWorkerRuntime,
  type ScannerWorkerFailure,
  type ScannerWorkerRequest,
  type ScannerWorkerResponse,
  type ScannerWorkerScope,
} from './worker-protocol';
import type {
  Announcement as EvmAnnouncement,
  HexString as EvmHexString,
} from '../chains/evm/types';
import type { Announcement as StellarAnnouncement } from '../chains/stellar/types';
import type { Announcement as SolanaAnnouncement } from '../chains/solana/types';
import type { StealthCell as CkbStealthCell, HexString as CkbHexString } from '../chains/ckb/types';
import type { MatchedAnnouncement } from './unified';

export {
  SCANNER_WORKER_PROTOCOL_VERSION,
  createScanAbortError,
  isScannerWorkerRequest,
  isScannerWorkerResponse,
  isScannerWorkerRuntime,
} from './worker-protocol';
export type {
  ScannerWorkerChain,
  ScannerWorkerCkbInput,
  ScannerWorkerEvmInput,
  ScannerWorkerFailure,
  ScannerWorkerFailureCode,
  ScannerWorkerInput,
  ScannerWorkerProgress,
  ScannerWorkerRequest,
  ScannerWorkerResponse,
  ScannerWorkerSolanaInput,
  ScannerWorkerStellarInput,
  ScannerWorkerScope,
} from './worker-protocol';
export {
  DEFAULT_SCANNER_WORKER_PROGRESS_INTERVAL,
  SCANNER_WORKER_CHAIN_ORDER,
  ScannerWorkerInputError,
  isScannerWorkerAbort,
  runScannerWorker,
  validateScannerWorkerInput,
} from './worker-core';
export type { ScannerWorkerRunOptions } from './worker-core';

// Re-export chain types used in the public worker API so api-extractor
// does not report them as forgotten exports.
export type { MatchedAnnouncement } from './unified';
export type {
  Announcement as EvmAnnouncement,
  HexString as EvmHexString,
} from '../chains/evm/types';
export type { Announcement as StellarAnnouncement } from '../chains/stellar/types';
export type { Announcement as SolanaAnnouncement } from '../chains/solana/types';
export type { StealthCell as CkbStealthCell, HexString as CkbHexString } from '../chains/ckb/types';

/**
 * Worker-side controller returned by {@link exposeScannerWorker}.
 */
export interface ScannerWorkerHandler {
  /** Feeds one raw `message` event payload through the protocol handler. */
  handleMessage(data: unknown): Promise<void>;
  /** Aborts every in-flight scan without removing the message listener. */
  cancelAll(): void;
  /** Aborts every scan and removes the message listener. */
  dispose(): void;
  /** Number of scans currently running. */
  readonly activeCount: number;
}

const EXPOSED_HANDLER = Symbol.for('@wraith-protocol/sdk/scanner/worker#handler');

interface ExposedScope extends ScannerWorkerScope {
  [EXPOSED_HANDLER]?: ScannerWorkerHandler;
}

function requestIdOf(data: unknown): string {
  if (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { requestId?: unknown }).requestId === 'string'
  ) {
    return (data as { requestId: string }).requestId;
  }
  return 'unknown';
}

/**
 * Creates a protocol handler that writes responses to `scope`.
 *
 * The handler is transport-agnostic: a dedicated worker, a service worker or a
 * test double only has to provide `postMessage` and `message` event methods.
 */
export function createScannerWorkerHandler(scope: ScannerWorkerScope): ScannerWorkerHandler {
  const active = new Map<string, AbortController>();
  let disposed = false;

  const post = (response: ScannerWorkerResponse): void => {
    if (disposed) return;
    try {
      scope.postMessage(response);
    } catch {
      // The host may have terminated the worker between messages.
    }
  };

  const fail = (requestId: string, failure: ScannerWorkerFailure): void => {
    post({ type: 'failure', requestId, failure });
  };

  const cancelAll = (): void => {
    for (const controller of active.values()) controller.abort();
    active.clear();
  };

  const handleMessage = async (data: unknown): Promise<void> => {
    if (disposed) return;

    if (!isScannerWorkerRequest(data)) {
      fail(requestIdOf(data), {
        code: 'invalid-message',
        message: 'Worker message must be a start or cancel request with a requestId',
      });
      return;
    }

    const { requestId } = data;

    if (data.type === 'cancel') {
      active.get(requestId)?.abort();
      return;
    }

    active.get(requestId)?.abort();

    const controller = new AbortController();
    active.set(requestId, controller);

    try {
      const matches = await runScannerWorker(data.input, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted) {
            post({ type: 'progress', requestId, progress });
          }
        },
      });
      if (!controller.signal.aborted) {
        post({ type: 'result', requestId, matches });
      }
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        fail(requestId, { code: 'cancelled', message: 'Scan cancelled' });
      } else if (error instanceof ScannerWorkerInputError) {
        fail(requestId, error.failure);
      } else {
        fail(requestId, {
          code: 'scan-failed',
          message: getUnknownErrorMessage(error),
        });
      }
    } finally {
      if (active.get(requestId) === controller) active.delete(requestId);
    }
  };

  const handler: ScannerWorkerHandler = {
    handleMessage,
    cancelAll,
    dispose: () => {
      disposed = true;
      cancelAll();
      const exposed = scope as ExposedScope;
      if (exposed[EXPOSED_HANDLER] === handler) delete exposed[EXPOSED_HANDLER];
    },
    get activeCount() {
      return active.size;
    },
  };

  return handler;
}

/**
 * Installs the worker message protocol on `scope`.
 *
 * Calling this more than once for the same scope returns the existing handler,
 * so the automatic install on module import cannot double-handle messages.
 */
export function exposeScannerWorker(scope: ScannerWorkerScope): ScannerWorkerHandler {
  const existing = (scope as ExposedScope)[EXPOSED_HANDLER];
  if (existing) return existing;

  const handler = createScannerWorkerHandler(scope);
  const listener = (event: MessageEvent<unknown>): void => {
    void handler.handleMessage(event.data);
  };

  scope.addEventListener('message', listener);
  (scope as ExposedScope)[EXPOSED_HANDLER] = handler;

  const dispose = handler.dispose;
  handler.dispose = (): void => {
    scope.removeEventListener('message', listener);
    dispose();
  };

  return handler;
}

if (isScannerWorkerRuntime()) {
  const scope = globalThis as unknown as ScannerWorkerScope;
  if (
    typeof scope.addEventListener === 'function' &&
    typeof scope.removeEventListener === 'function' &&
    typeof scope.postMessage === 'function'
  ) {
    exposeScannerWorker(scope);
  }
}
