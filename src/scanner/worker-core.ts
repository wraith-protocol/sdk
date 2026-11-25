import { isAbortError } from '../chains/errorUtils';
import { scanAll } from './unified';
import type { MatchedAnnouncement } from './unified';
import {
  createScanAbortError,
  type ScannerWorkerChain,
  type ScannerWorkerFailure,
  type ScannerWorkerInput,
  type ScannerWorkerProgress,
} from './worker-protocol';

/**
 * Chain order used to produce deterministic worker results.
 *
 * The main-thread `scanAll` interleaves chains as results arrive. A worker
 * needs a stable order so two runs over the same vectors compare directly, so
 * chains are scanned in this sequence and matches from each chain keep their
 * input order.
 */
export const SCANNER_WORKER_CHAIN_ORDER: readonly ScannerWorkerChain[] = [
  'evm',
  'stellar',
  'solana',
  'ckb',
];

/** Default number of items between progress messages. */
export const DEFAULT_SCANNER_WORKER_PROGRESS_INTERVAL = 256;

/**
 * Options for {@link runScannerWorker}.
 */
export interface ScannerWorkerRunOptions {
  /** Aborts the scan and releases the active chain iterator. */
  signal?: AbortSignal;
  /** Called when items are handed to a chain scanner. */
  onProgress?: (progress: ScannerWorkerProgress) => void;
  /**
   * Number of items between progress callbacks. Defaults to
   * {@link DEFAULT_SCANNER_WORKER_PROGRESS_INTERVAL}. A final callback for each
   * chain is always emitted with `processed === total`.
   */
  progressInterval?: number;
}

/**
 * Raised when the input cannot be scanned as structured data.
 *
 * The worker handler maps this onto the `invalid-input` failure code instead
 * of the generic `scan-failed` code.
 */
export class ScannerWorkerInputError extends Error {
  /** Serializable failure to put on the wire. */
  readonly failure: ScannerWorkerFailure;

  constructor(failure: ScannerWorkerFailure) {
    super(failure.message);
    this.name = 'ScannerWorkerInputError';
    this.failure = failure;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArrayOrUndefined(value: unknown): boolean {
  return Array.isArray(value);
}

function isValidEvmInput(value: unknown): boolean {
  return (
    isRecord(value) &&
    isStringArrayOrUndefined(value.announcements) &&
    typeof value.viewingKey === 'string' &&
    typeof value.spendingPubKey === 'string' &&
    typeof value.spendingKey === 'string'
  );
}

function isValidEd25519Input(value: unknown): boolean {
  return (
    isRecord(value) &&
    isStringArrayOrUndefined(value.announcements) &&
    value.viewingKey instanceof Uint8Array &&
    value.spendingPubKey instanceof Uint8Array &&
    typeof value.spendingScalar === 'bigint'
  );
}

function isValidCkbInput(value: unknown): boolean {
  return (
    isRecord(value) &&
    isStringArrayOrUndefined(value.cells) &&
    typeof value.viewingKey === 'string' &&
    typeof value.spendingPubKey === 'string' &&
    typeof value.spendingKey === 'string'
  );
}

/**
 * Validates the shape of a worker scan input.
 *
 * Returns a serializable failure, or `null` when the input is usable. The
 * check is intentionally shallow: malformed individual announcements are the
 * chain scanner's job, and surface as `scan-failed` if they cannot be parsed.
 */
export function validateScannerWorkerInput(input: unknown): ScannerWorkerFailure | null {
  if (!isRecord(input)) {
    return { code: 'invalid-input', message: 'Scan input must be an object' };
  }

  if (input.evm !== undefined && !isValidEvmInput(input.evm)) {
    return { code: 'invalid-input', chain: 'evm', message: 'Invalid EVM scan input' };
  }
  if (input.stellar !== undefined && !isValidEd25519Input(input.stellar)) {
    return { code: 'invalid-input', chain: 'stellar', message: 'Invalid Stellar scan input' };
  }
  if (input.solana !== undefined && !isValidEd25519Input(input.solana)) {
    return { code: 'invalid-input', chain: 'solana', message: 'Invalid Solana scan input' };
  }
  if (input.ckb !== undefined && !isValidCkbInput(input.ckb)) {
    return { code: 'invalid-input', chain: 'ckb', message: 'Invalid CKB scan input' };
  }

  return null;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createScanAbortError();
}

function emitProgress(options: ScannerWorkerRunOptions, progress: ScannerWorkerProgress): void {
  try {
    options.onProgress?.(progress);
  } catch {
    // Ignore a throwing progress callback and continue scanning.
  }
}

/**
 * Wraps an array in an async iterable that reports progress and observes an
 * abort signal before each item.
 */
async function* progressSource<T>(
  chain: ScannerWorkerChain,
  items: T[],
  options: ScannerWorkerRunOptions,
): AsyncGenerator<T> {
  const interval = Math.max(
    1,
    Math.floor(options.progressInterval ?? DEFAULT_SCANNER_WORKER_PROGRESS_INTERVAL),
  );
  const total = items.length;

  for (let index = 0; index < total; index += 1) {
    throwIfAborted(options.signal);
    const processed = index + 1;
    if (processed % interval === 0 || processed === total) {
      emitProgress(options, { chain, processed, total });
    }
    yield items[index];
  }
}

async function collectMatches(
  stream: AsyncGenerator<MatchedAnnouncement>,
): Promise<MatchedAnnouncement[]> {
  const matches: MatchedAnnouncement[] = [];
  try {
    for await (const match of stream) matches.push(match);
  } finally {
    await stream.return?.(undefined);
  }
  return matches;
}

/**
 * Scans one chain in input order, using the same adapters as the main-thread
 * `scanAll`.
 */
async function scanChain(
  chain: ScannerWorkerChain,
  input: ScannerWorkerInput,
  options: ScannerWorkerRunOptions,
): Promise<MatchedAnnouncement[]> {
  throwIfAborted(options.signal);

  switch (chain) {
    case 'evm': {
      const evm = input.evm;
      if (!evm) return [];
      emitProgress(options, { chain, processed: 0, total: evm.announcements.length });
      const source = progressSource(chain, evm.announcements, options);
      return collectMatches(
        scanAll({
          evm: {
            source,
            viewingKey: evm.viewingKey,
            spendingPubKey: evm.spendingPubKey,
            spendingKey: evm.spendingKey,
          },
        }),
      );
    }
    case 'stellar': {
      const stellar = input.stellar;
      if (!stellar) return [];
      emitProgress(options, { chain, processed: 0, total: stellar.announcements.length });
      const source = progressSource(chain, stellar.announcements, options);
      return collectMatches(
        scanAll({
          stellar: {
            source,
            viewingKey: stellar.viewingKey,
            spendingPubKey: stellar.spendingPubKey,
            spendingScalar: stellar.spendingScalar,
          },
        }),
      );
    }
    case 'solana': {
      const solana = input.solana;
      if (!solana) return [];
      emitProgress(options, { chain, processed: 0, total: solana.announcements.length });
      const source = progressSource(chain, solana.announcements, options);
      return collectMatches(
        scanAll({
          solana: {
            source,
            viewingKey: solana.viewingKey,
            spendingPubKey: solana.spendingPubKey,
            spendingScalar: solana.spendingScalar,
          },
        }),
      );
    }
    case 'ckb': {
      const ckb = input.ckb;
      if (!ckb) return [];
      emitProgress(options, { chain, processed: 0, total: ckb.cells.length });
      const source = progressSource(chain, ckb.cells, options);
      return collectMatches(
        scanAll({
          ckb: {
            source,
            viewingKey: ckb.viewingKey,
            spendingPubKey: ckb.spendingPubKey,
            spendingKey: ckb.spendingKey,
          },
        }),
      );
    }
  }
}

/**
 * Runs a deterministic scan over structured-clone safe input.
 *
 * Results are ordered by {@link SCANNER_WORKER_CHAIN_ORDER}, then by the order
 * of the announcement (or cell) in the input array, so the same vectors always
 * produce the same sequence regardless of worker timing. Cancelling the signal
 * throws an `AbortError` after releasing the active iterator.
 *
 * @throws {ScannerWorkerInputError} When the input shape is invalid.
 * @throws {Error} With `name === 'AbortError'` when the signal aborts.
 */
export async function runScannerWorker(
  input: ScannerWorkerInput,
  options: ScannerWorkerRunOptions = {},
): Promise<MatchedAnnouncement[]> {
  const failure = validateScannerWorkerInput(input);
  if (failure) throw new ScannerWorkerInputError(failure);

  const matches: MatchedAnnouncement[] = [];

  for (const chain of SCANNER_WORKER_CHAIN_ORDER) {
    throwIfAborted(options.signal);

    const chainInput = input[chain];
    if (!chainInput) continue;

    const chainMatches = await scanChain(chain, input, options);
    matches.push(...chainMatches);
  }

  return matches;
}

/**
 * Returns true when an error came from a cancelled worker scan.
 *
 * Exposed so a custom handler can distinguish cancellation from a real scan
 * failure without duplicating the `AbortError` name check.
 */
export function isScannerWorkerAbort(error: unknown): boolean {
  return isAbortError(error);
}
