import { ref, readonly, getCurrentScope, onScopeDispose } from 'vue';
import {
  fetchAnnouncements as evmFetchAnnouncements,
  scanAnnouncements as evmScanAnnouncements,
  checkStealthAddress as evmCheckAddress,
  type HexString,
  type StealthKeys as EvmStealthKeys,
  type Announcement as EvmAnnouncement,
  type MatchedAnnouncement as EvmMatchedAnnouncement,
} from '@wraith-protocol/sdk/chains/evm';
import {
  fetchAnnouncementsStream as stellarFetchAnnouncementsStream,
  scanAnnouncements as stellarScanAnnouncements,
  checkStealthAddress as stellarCheckAddress,
  type FetchAnnouncementsOptions,
  type StealthKeys as StellarStealthKeys,
  type Announcement as StellarAnnouncement,
  type MatchedAnnouncement as StellarMatchedAnnouncement,
} from '@wraith-protocol/sdk/chains/stellar';
import {
  fetchAnnouncements as solanaFetchAnnouncements,
  scanAnnouncements as solanaScanAnnouncements,
  checkStealthAddress as solanaCheckAddress,
  type StealthKeys as SolanaStealthKeys,
  type Announcement as SolanaAnnouncement,
  type MatchedAnnouncement as SolanaMatchedAnnouncement,
} from '@wraith-protocol/sdk/chains/solana';
import {
  getUnknownErrorMessage,
  isAbortError,
  type ScanCancellationOptions,
} from '@wraith-protocol/sdk';

/** Chains the Vue scanner can read announcements from. */
export type ScannerChain = 'evm' | 'stellar' | 'solana';

export type AnyAnnouncement = EvmAnnouncement | StellarAnnouncement | SolanaAnnouncement;
export type AnyMatchedAnnouncement =
  | EvmMatchedAnnouncement
  | StellarMatchedAnnouncement
  | SolanaMatchedAnnouncement;

export type EvmCheckResult = ReturnType<typeof evmCheckAddress>;
export type StellarCheckResult = ReturnType<typeof stellarCheckAddress>;
export type SolanaCheckResult = ReturnType<typeof solanaCheckAddress>;

/**
 * Options for an EVM announcement fetch.
 *
 * The `chain` field is the discriminant: pairing it with Stellar or Solana key
 * material is a compile-time error.
 */
export interface EvmFetchOptions extends ScanCancellationOptions {
  chain: 'evm';
  /** EVM deployment key, for example `horizen`. Defaults to `horizen`. */
  network?: string;
  /** Subgraph URL override. */
  url?: string;
}

/** Options for a Stellar announcement fetch. */
export interface StellarFetchOptions
  extends Omit<FetchAnnouncementsOptions, 'signal' | 'sorobanUrl'>, ScanCancellationOptions {
  chain: 'stellar';
  /** Stellar deployment key. Defaults to `stellar`. */
  network?: string;
  /** Soroban RPC URL override. */
  url?: string;
}

/** Options for a Solana announcement fetch. */
export interface SolanaFetchOptions extends ScanCancellationOptions {
  chain: 'solana';
  /** Solana deployment key. Defaults to `solana`. */
  network?: string;
  /** RPC URL override. */
  url?: string;
}

/** One cancellation shape for every chain the Vue scanner supports. */
export type ScannerFetchOptions = EvmFetchOptions | StellarFetchOptions | SolanaFetchOptions;

/** EVM announcements plus the EVM key material required to scan them. */
export interface EvmScanInput {
  chain: 'evm';
  announcements: EvmAnnouncement[];
  keys: EvmStealthKeys;
}

/** Stellar announcements plus the Stellar key material required to scan them. */
export interface StellarScanInput {
  chain: 'stellar';
  announcements: StellarAnnouncement[];
  keys: StellarStealthKeys;
}

/** Solana announcements plus the Solana key material required to scan them. */
export interface SolanaScanInput {
  chain: 'solana';
  announcements: SolanaAnnouncement[];
  keys: SolanaStealthKeys;
}

export type ScannerScanInput = EvmScanInput | StellarScanInput | SolanaScanInput;

/** EVM keys plus the fetch options used by {@link useScanner}'s `scanWithKeys`. */
export type EvmScanWithKeysInput = EvmFetchOptions & { keys: EvmStealthKeys };
export type StellarScanWithKeysInput = StellarFetchOptions & { keys: StellarStealthKeys };
export type SolanaScanWithKeysInput = SolanaFetchOptions & { keys: SolanaStealthKeys };
export type ScannerScanWithKeysInput =
  | EvmScanWithKeysInput
  | StellarScanWithKeysInput
  | SolanaScanWithKeysInput;

export interface EvmCheckInput {
  chain: 'evm';
  ephemeralPubKey: HexString;
  viewingKey: HexString;
  spendingPubKey: HexString;
  viewTag: number;
}

export interface StellarCheckInput {
  chain: 'stellar';
  ephemeralPubKey: Uint8Array;
  viewingKey: Uint8Array;
  spendingPubKey: Uint8Array;
  viewTag: number;
}

export interface SolanaCheckInput {
  chain: 'solana';
  ephemeralPubKey: Uint8Array;
  viewingKey: Uint8Array;
  spendingPubKey: Uint8Array;
  viewTag: number;
}

export type ScannerCheckInput = EvmCheckInput | StellarCheckInput | SolanaCheckInput;

function abortError(): DOMException {
  return new DOMException('This operation was aborted', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof AbortSignal !== 'undefined' && value instanceof AbortSignal;
}

function describe(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value);
}

/** Narrows a runtime value to a scanner chain, for JavaScript consumers. */
export function assertScannerChain(value: unknown): asserts value is ScannerChain {
  if (value !== 'evm' && value !== 'stellar' && value !== 'solana') {
    throw new TypeError(
      `Unsupported scanner chain ${describe(value)}. Expected "evm", "stellar" or "solana".`,
    );
  }
}

function assertOptionalString(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new TypeError(`Scanner option "${field}" must be a string when provided.`);
  }
}

/**
 * Validates scanner fetch options at runtime.
 *
 * TypeScript consumers get the same guarantees from {@link ScannerFetchOptions};
 * this guard keeps JavaScript consumers from pairing a chain with the wrong
 * endpoint or a non-signal cancellation value.
 */
export function assertScannerFetchOptions(value: unknown): asserts value is ScannerFetchOptions {
  if (!isRecord(value)) {
    throw new TypeError('Scanner options must be an object with a "chain" field.');
  }
  assertScannerChain(value.chain);
  assertOptionalString(value.network, 'network');
  assertOptionalString(value.url, 'url');
  if (value.signal !== undefined && !isAbortSignal(value.signal)) {
    throw new TypeError('Scanner option "signal" must be an AbortSignal when provided.');
  }
  if (value.chain === 'stellar') {
    if (value.fromLedger !== undefined && !Number.isInteger(value.fromLedger)) {
      throw new TypeError('Scanner option "fromLedger" must be an integer when provided.');
    }
    if (value.toLedger !== undefined && !Number.isInteger(value.toLedger)) {
      throw new TypeError('Scanner option "toLedger" must be an integer when provided.');
    }
    if (value.viewTagBuckets !== undefined && !Array.isArray(value.viewTagBuckets)) {
      throw new TypeError('Scanner option "viewTagBuckets" must be an array when provided.');
    }
  }
}

function assertKeyMaterial(chain: ScannerChain, value: unknown): void {
  if (!isRecord(value)) {
    throw new TypeError(`Scanner keys for "${chain}" must be an object.`);
  }

  if (chain === 'evm') {
    for (const field of ['viewingKey', 'spendingPubKey', 'spendingKey'] as const) {
      if (typeof value[field] !== 'string') {
        throw new TypeError(`EVM scanner keys must provide a 0x-prefixed hex string "${field}".`);
      }
    }
    return;
  }

  for (const field of ['viewingKey', 'spendingPubKey'] as const) {
    if (!(value[field] instanceof Uint8Array)) {
      throw new TypeError(`${chain} scanner keys must provide a Uint8Array "${field}".`);
    }
  }
  if (typeof value.spendingScalar !== 'bigint') {
    throw new TypeError(`${chain} scanner keys must provide a bigint "spendingScalar".`);
  }
}

/**
 * Validates a {@link ScannerScanInput} at runtime.
 *
 * Rejects mismatched key material (for example EVM keys on a Stellar scan) with
 * a `TypeError` instead of failing later inside the chain scanner.
 */
export function assertScannerScanInput(value: unknown): asserts value is ScannerScanInput {
  if (!isRecord(value)) {
    throw new TypeError('scanAnnouncements expects an object with chain, announcements and keys.');
  }
  assertScannerChain(value.chain);
  if (!Array.isArray(value.announcements)) {
    throw new TypeError('scanAnnouncements expects "announcements" to be an array.');
  }
  assertKeyMaterial(value.chain, value.keys);
}

/** Validates a {@link ScannerScanWithKeysInput} at runtime. */
export function assertScannerScanWithKeysInput(
  value: unknown,
): asserts value is ScannerScanWithKeysInput {
  assertScannerFetchOptions(value);
  assertKeyMaterial(value.chain, (value as { keys?: unknown }).keys);
}

/** Validates a {@link ScannerCheckInput} at runtime. */
export function assertScannerCheckInput(value: unknown): asserts value is ScannerCheckInput {
  if (!isRecord(value)) {
    throw new TypeError('checkAddress expects an object with chain and key material.');
  }
  assertScannerChain(value.chain);
  if (
    !Number.isInteger(value.viewTag) ||
    (value.viewTag as number) < 0 ||
    (value.viewTag as number) > 255
  ) {
    throw new TypeError('checkAddress expects "viewTag" to be an integer between 0 and 255.');
  }
  if (value.chain === 'evm') {
    for (const field of ['ephemeralPubKey', 'viewingKey', 'spendingPubKey'] as const) {
      if (typeof value[field] !== 'string') {
        throw new TypeError(`EVM checkAddress expects a 0x-prefixed hex string "${field}".`);
      }
    }
    return;
  }
  for (const field of ['ephemeralPubKey', 'viewingKey', 'spendingPubKey'] as const) {
    if (!(value[field] instanceof Uint8Array)) {
      throw new TypeError(`${value.chain} checkAddress expects a Uint8Array "${field}".`);
    }
  }
}

/**
 * Wraps a promise so it rejects as soon as `signal` aborts.
 *
 * The EVM and Solana fetchers do not accept an `AbortSignal` yet. Racing their
 * promise keeps the framework contract identical to Stellar's: an aborted scan
 * rejects with `AbortError` and never publishes a late result.
 */
function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

async function fetchEvm(options: EvmFetchOptions, signal: AbortSignal): Promise<EvmAnnouncement[]> {
  throwIfAborted(signal);
  const announcements = await withAbort(
    evmFetchAnnouncements(options.network ?? 'horizen', options.url),
    signal,
  );
  throwIfAborted(signal);
  return announcements;
}

async function fetchStellar(
  options: StellarFetchOptions,
  signal: AbortSignal,
): Promise<StellarAnnouncement[]> {
  throwIfAborted(signal);
  const { chain: _chain, network, url, ...rest } = options;
  const stream = stellarFetchAnnouncementsStream(network ?? 'stellar', {
    ...rest,
    signal,
    sorobanUrl: url,
  });
  const announcements: StellarAnnouncement[] = [];
  for await (const announcement of stream) {
    throwIfAborted(signal);
    announcements.push(announcement);
  }
  return announcements;
}

async function fetchSolana(
  options: SolanaFetchOptions,
  signal: AbortSignal,
): Promise<SolanaAnnouncement[]> {
  throwIfAborted(signal);
  const announcements = await withAbort(
    solanaFetchAnnouncements(options.network ?? 'solana', options.url),
    signal,
  );
  throwIfAborted(signal);
  return announcements;
}

export function useScanner(chain?: ScannerChain) {
  const activeChain = ref<ScannerChain>(chain ?? 'stellar');
  const announcements = ref<AnyAnnouncement[]>([]);
  const matched = ref<AnyMatchedAnnouncement[]>([]);
  const scanning = ref(false);
  const error = ref<string | null>(null);

  let activeController: AbortController | null = null;
  let requestId = 0;
  let disposed = false;

  function abortActive(): void {
    activeController?.abort();
    activeController = null;
  }

  function dispose(): void {
    disposed = true;
    abortActive();
  }

  if (getCurrentScope()) {
    onScopeDispose(dispose);
  }

  function setChain(next: ScannerChain) {
    assertScannerChain(next);
    if (next === activeChain.value) return;
    // The in-flight request belongs to the previous chain; never publish it.
    abortActive();
    activeChain.value = next;
  }

  function beginRequest(): { controller: AbortController; id: number } {
    abortActive();
    const controller = new AbortController();
    activeController = controller;
    return { controller, id: ++requestId };
  }

  function isCurrent(id: number, controller: AbortController): boolean {
    return !disposed && requestId === id && !controller.signal.aborted;
  }

  /**
   * Runs one cancellable request.
   *
   * Aborts any request that is already in flight, forwards the caller's signal
   * into an internal controller, and only publishes a result that is still the
   * newest one when it arrives.
   */
  async function runCancellable<T>(
    externalSignal: AbortSignal | undefined,
    run: (signal: AbortSignal) => Promise<T>,
    publish: (value: T) => void,
  ): Promise<T> {
    const { controller, id } = beginRequest();

    const forwardAbort = () => controller.abort(externalSignal?.reason);
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort(externalSignal.reason);
      else externalSignal.addEventListener('abort', forwardAbort, { once: true });
    }

    scanning.value = true;
    error.value = null;
    try {
      throwIfAborted(controller.signal);
      const value = await run(controller.signal);
      if (!isCurrent(id, controller)) throw abortError();
      publish(value);
      return value;
    } catch (cause) {
      if (isAbortError(cause) || controller.signal.aborted || !isCurrent(id, controller)) {
        throw isAbortError(cause) ? cause : abortError();
      }
      error.value = getUnknownErrorMessage(cause);
      throw cause;
    } finally {
      externalSignal?.removeEventListener('abort', forwardAbort);
      if (activeController === controller) {
        activeController = null;
        if (!disposed) scanning.value = false;
      }
    }
  }

  function publishAnnouncements(list: AnyAnnouncement[]): void {
    announcements.value = list;
  }

  async function fetchAnnouncements(request?: ScannerFetchOptions): Promise<AnyAnnouncement[]> {
    const resolved: ScannerFetchOptions = request ?? { chain: activeChain.value };
    assertScannerFetchOptions(resolved);

    switch (resolved.chain) {
      case 'evm':
        return runCancellable(
          resolved.signal,
          (signal) => fetchEvm(resolved, signal),
          publishAnnouncements,
        );
      case 'stellar':
        return runCancellable(
          resolved.signal,
          (signal) => fetchStellar(resolved, signal),
          publishAnnouncements,
        );
      case 'solana':
        return runCancellable(
          resolved.signal,
          (signal) => fetchSolana(resolved, signal),
          publishAnnouncements,
        );
    }
  }

  function scanAnnouncements(input: EvmScanInput): EvmMatchedAnnouncement[];
  function scanAnnouncements(input: StellarScanInput): StellarMatchedAnnouncement[];
  function scanAnnouncements(input: SolanaScanInput): SolanaMatchedAnnouncement[];
  function scanAnnouncements(input: ScannerScanInput): AnyMatchedAnnouncement[];
  function scanAnnouncements(input: ScannerScanInput): AnyMatchedAnnouncement[] {
    assertScannerScanInput(input);
    if (disposed) throw abortError();

    scanning.value = true;
    error.value = null;
    try {
      let result: AnyMatchedAnnouncement[];
      switch (input.chain) {
        case 'evm':
          result = evmScanAnnouncements(
            input.announcements,
            input.keys.viewingKey,
            input.keys.spendingPubKey,
            input.keys.spendingKey,
          );
          break;
        case 'stellar':
          result = stellarScanAnnouncements(
            input.announcements,
            input.keys.viewingKey,
            input.keys.spendingPubKey,
            input.keys.spendingScalar,
          );
          break;
        case 'solana':
          result = solanaScanAnnouncements(
            input.announcements,
            input.keys.viewingKey,
            input.keys.spendingPubKey,
            input.keys.spendingScalar,
          );
          break;
      }
      matched.value = result;
      return result;
    } catch (cause) {
      error.value = getUnknownErrorMessage(cause);
      throw cause;
    } finally {
      scanning.value = false;
    }
  }

  function checkAddress(input: EvmCheckInput): EvmCheckResult;
  function checkAddress(input: StellarCheckInput): StellarCheckResult;
  function checkAddress(input: SolanaCheckInput): SolanaCheckResult;
  function checkAddress(
    input: ScannerCheckInput,
  ): EvmCheckResult | StellarCheckResult | SolanaCheckResult;
  function checkAddress(
    input: ScannerCheckInput,
  ): EvmCheckResult | StellarCheckResult | SolanaCheckResult {
    assertScannerCheckInput(input);

    scanning.value = true;
    error.value = null;
    try {
      switch (input.chain) {
        case 'evm':
          return evmCheckAddress(
            input.ephemeralPubKey,
            input.viewingKey,
            input.spendingPubKey,
            input.viewTag,
          );
        case 'stellar':
          return stellarCheckAddress(
            input.ephemeralPubKey,
            input.viewingKey,
            input.spendingPubKey,
            input.viewTag,
          );
        case 'solana':
          return solanaCheckAddress(
            input.ephemeralPubKey,
            input.viewingKey,
            input.spendingPubKey,
            input.viewTag,
          );
      }
    } catch (cause) {
      error.value = getUnknownErrorMessage(cause);
      throw cause;
    } finally {
      scanning.value = false;
    }
  }

  async function scanWithKeys(input: EvmScanWithKeysInput): Promise<EvmMatchedAnnouncement[]>;
  async function scanWithKeys(
    input: StellarScanWithKeysInput,
  ): Promise<StellarMatchedAnnouncement[]>;
  async function scanWithKeys(input: SolanaScanWithKeysInput): Promise<SolanaMatchedAnnouncement[]>;
  async function scanWithKeys(input: ScannerScanWithKeysInput): Promise<AnyMatchedAnnouncement[]>;
  async function scanWithKeys(input: ScannerScanWithKeysInput): Promise<AnyMatchedAnnouncement[]> {
    assertScannerScanWithKeysInput(input);

    switch (input.chain) {
      case 'evm':
        return runCancellable(
          input.signal,
          async (signal) => {
            const list = await fetchEvm(input, signal);
            return evmScanAnnouncements(
              list,
              input.keys.viewingKey,
              input.keys.spendingPubKey,
              input.keys.spendingKey,
            );
          },
          (result) => {
            matched.value = result;
          },
        );
      case 'stellar':
        return runCancellable(
          input.signal,
          async (signal) => {
            const list = await fetchStellar(input, signal);
            return stellarScanAnnouncements(
              list,
              input.keys.viewingKey,
              input.keys.spendingPubKey,
              input.keys.spendingScalar,
            );
          },
          (result) => {
            matched.value = result;
          },
        );
      case 'solana':
        return runCancellable(
          input.signal,
          async (signal) => {
            const list = await fetchSolana(input, signal);
            return solanaScanAnnouncements(
              list,
              input.keys.viewingKey,
              input.keys.spendingPubKey,
              input.keys.spendingScalar,
            );
          },
          (result) => {
            matched.value = result;
          },
        );
    }
  }

  function clear() {
    announcements.value = [];
    matched.value = [];
    error.value = null;
  }

  return {
    announcements: readonly(announcements),
    matched: readonly(matched),
    scanning: readonly(scanning),
    error: readonly(error),
    chain: readonly(activeChain),
    setChain,
    fetchAnnouncements,
    scanAnnouncements,
    checkAddress,
    scanWithKeys,
    clear,
    dispose,
  };
}
