import type {
  Announcement as EvmAnnouncement,
  HexString as EvmHexString,
} from '../chains/evm/types';
import type { Announcement as StellarAnnouncement } from '../chains/stellar/types';
import type { Announcement as SolanaAnnouncement } from '../chains/solana/types';
import type { StealthCell as CkbStealthCell, HexString as CkbHexString } from '../chains/ckb/types';
import type { MatchedAnnouncement } from './unified';

/**
 * Wire version carried by the Web Worker message schema.
 *
 * The schema only changes when a request or response shape changes in a way
 * that is not backward compatible. A worker and its host must agree on this
 * value before exchanging scan requests.
 */
export const SCANNER_WORKER_PROTOCOL_VERSION = 1;

/**
 * Chain identifiers accepted by the worker scanner.
 */
export type ScannerWorkerChain = 'evm' | 'stellar' | 'solana' | 'ckb';

/**
 * EVM scan input sent to the worker.
 *
 * Every field is structured-clone compatible: announcements and hex strings
 * cross the worker boundary as plain data, never as executable code.
 */
export interface ScannerWorkerEvmInput {
  /** Raw ERC-5564 announcements to scan. */
  announcements: EvmAnnouncement[];
  /** Recipient's 32-byte viewing private key, hex encoded. */
  viewingKey: EvmHexString;
  /** Recipient's 33-byte compressed spending public key, hex encoded. */
  spendingPubKey: EvmHexString;
  /** Recipient's 32-byte spending private key, hex encoded. */
  spendingKey: EvmHexString;
}

/**
 * Stellar scan input sent to the worker.
 */
export interface ScannerWorkerStellarInput {
  /** Raw Stellar announcements to scan. */
  announcements: StellarAnnouncement[];
  /** Recipient's 32-byte viewing seed. */
  viewingKey: Uint8Array;
  /** Recipient's 32-byte spending public key. */
  spendingPubKey: Uint8Array;
  /** Recipient's private spending scalar. */
  spendingScalar: bigint;
}

/**
 * Solana scan input sent to the worker.
 */
export interface ScannerWorkerSolanaInput {
  /** Raw Solana announcements to scan. */
  announcements: SolanaAnnouncement[];
  /** Recipient's 32-byte viewing seed. */
  viewingKey: Uint8Array;
  /** Recipient's 32-byte spending public key. */
  spendingPubKey: Uint8Array;
  /** Recipient's private spending scalar. */
  spendingScalar: bigint;
}

/**
 * CKB scan input sent to the worker.
 */
export interface ScannerWorkerCkbInput {
  /** Raw CKB stealth cells to scan. */
  cells: CkbStealthCell[];
  /** Recipient's 32-byte viewing private key, hex encoded. */
  viewingKey: CkbHexString;
  /** Recipient's 33-byte compressed spending public key, hex encoded. */
  spendingPubKey: CkbHexString;
  /** Recipient's 32-byte spending private key, hex encoded. */
  spendingKey: CkbHexString;
}

/**
 * Structured-clone compatible scan input for the worker scanner.
 *
 * Unlike {@link import('./unified').ScanAllInput}, every source is an array
 * rather than an async iterable, so the value can cross a `postMessage`
 * boundary unchanged. Chains that are absent are not scanned.
 */
export interface ScannerWorkerInput {
  evm?: ScannerWorkerEvmInput;
  stellar?: ScannerWorkerStellarInput;
  solana?: ScannerWorkerSolanaInput;
  ckb?: ScannerWorkerCkbInput;
}

/**
 * Progress snapshot emitted while a worker scan is running.
 *
 * `processed` counts announcements (or cells for CKB) handed to the chain
 * scanner so far, and never exceeds `total`.
 */
export interface ScannerWorkerProgress {
  /** Chain currently being scanned. */
  chain: ScannerWorkerChain;
  /** Number of items handed to the scanner so far. */
  processed: number;
  /** Total number of items supplied for this chain. */
  total: number;
}

/**
 * Stable failure codes for worker responses.
 */
export type ScannerWorkerFailureCode =
  | 'invalid-message'
  | 'invalid-input'
  | 'cancelled'
  | 'disposed'
  | 'scan-failed'
  | 'version-mismatch';

/**
 * Serializable failure payload. Never an `Error` instance, because not every
 * worker transport preserves error subclasses across the boundary.
 */
export interface ScannerWorkerFailure {
  /** Machine-readable failure category. */
  code: ScannerWorkerFailureCode;
  /** Human-readable description safe to surface in a UI or log. */
  message: string;
  /** Chain that failed, when the failure is chain-specific. */
  chain?: ScannerWorkerChain;
}

/**
 * Fields shared by every request and response envelope.
 *
 * `version` carries {@link SCANNER_WORKER_PROTOCOL_VERSION} so both sides can
 * reject a peer that speaks a different schema before interpreting the rest of
 * the message.
 */
export interface ScannerWorkerEnvelope {
  /** Protocol version the sender is speaking. */
  version: number;
  /** Identifies the scan this message belongs to. */
  requestId: string;
}

/**
 * Request a host sends to the worker.
 *
 * `start` begins one scan identified by `requestId`. `cancel` aborts the scan
 * with the matching id and releases its iterators.
 */
export type ScannerWorkerRequest =
  | (ScannerWorkerEnvelope & {
      type: 'start';
      input: ScannerWorkerInput;
    })
  | (ScannerWorkerEnvelope & {
      type: 'cancel';
    });

/**
 * Message the worker sends back to its host.
 *
 * A scan produces zero or more `progress` messages and exactly one terminal
 * `result` or `failure` message with the same `requestId`.
 */
export type ScannerWorkerResponse =
  | (ScannerWorkerEnvelope & {
      type: 'progress';
      progress: ScannerWorkerProgress;
    })
  | (ScannerWorkerEnvelope & {
      type: 'result';
      matches: MatchedAnnouncement[];
    })
  | (ScannerWorkerEnvelope & {
      type: 'failure';
      failure: ScannerWorkerFailure;
    });

/**
 * Minimal worker-side scope the handler needs.
 *
 * A browser `DedicatedWorkerGlobalScope` (or `ServiceWorkerGlobalScope`)
 * satisfies this interface, and so does a test double.
 */
export interface ScannerWorkerScope {
  postMessage(message: ScannerWorkerResponse): void;
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
}

/**
 * Creates the cancellation error the scanner throws.
 *
 * Uses the platform `DOMException` when present so consumers can keep checking
 * `error.name === 'AbortError'` exactly as they do for the main-thread
 * scanners. Runtimes without `DOMException` get an `Error` with the same name.
 */
export function createScanAbortError(message = 'Scan cancelled'): Error {
  if (typeof DOMException === 'function') {
    return new DOMException(message, 'AbortError');
  }
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Reads the protocol version from an untrusted message, when present.
 *
 * Both boundaries use this before decoding the rest of the envelope so a peer
 * built against another schema version is rejected instead of being parsed as
 * if it were compatible.
 */
export function getScannerWorkerProtocolVersion(value: unknown): number | undefined {
  if (!isRecord(value) || typeof value.version !== 'number') return undefined;
  return value.version;
}

/**
 * Narrows an untyped `message` event payload to a request.
 *
 * This only checks the envelope, including the protocol version. Input
 * validation runs in the worker core, so a malformed `input` still produces a
 * typed `invalid-input` failure rather than being dropped silently.
 */
export function isScannerWorkerRequest(value: unknown): value is ScannerWorkerRequest {
  if (!isRecord(value) || value.version !== SCANNER_WORKER_PROTOCOL_VERSION) return false;
  if (typeof value.requestId !== 'string') return false;
  if (value.type === 'start') return isRecord(value.input);
  return value.type === 'cancel';
}

/**
 * Narrows an untyped `message` event payload to a response.
 *
 * This checks the envelope version, so a response from an incompatible worker
 * build is rejected before its payload is read.
 */
export function isScannerWorkerResponse(value: unknown): value is ScannerWorkerResponse {
  if (!isRecord(value) || value.version !== SCANNER_WORKER_PROTOCOL_VERSION) return false;
  if (typeof value.requestId !== 'string') return false;
  if (value.type === 'progress') return isRecord(value.progress);
  if (value.type === 'result') return Array.isArray(value.matches);
  if (value.type === 'failure') return isRecord(value.failure);
  return false;
}

/**
 * Returns true when the code is running inside a Web Worker global scope.
 *
 * The check is deliberately runtime-based rather than build-time-based, so the
 * same entry point can be imported by a host page without installing a
 * message listener.
 */
export function isScannerWorkerRuntime(): boolean {
  const scope = globalThis as {
    self?: unknown;
    document?: unknown;
    postMessage?: unknown;
    addEventListener?: unknown;
  };
  return (
    typeof scope.document === 'undefined' &&
    typeof scope.self !== 'undefined' &&
    typeof scope.postMessage === 'function' &&
    typeof scope.addEventListener === 'function'
  );
}
