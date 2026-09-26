import type { HexString } from '../chains/evm/types';
import {
  WalletNotConnectedError,
  WalletRequestFailedError,
  WalletUnavailableError,
  WalletUserRejectedError,
  WalletWrongNetworkError,
  WraithWalletError,
  type WalletErrorDetails,
} from '../errors';
import type {
  EvmWalletAdapter,
  SolanaChainWalletAdapter,
  StellarWalletAdapter,
  WalletAdapter,
  WalletAdapterChain,
} from './adapter';

type WalletErrorKind = 'not-connected' | 'user-rejected' | 'wrong-network' | 'unavailable';

const ERROR_CLASSES: Record<
  WalletErrorKind,
  new (details: WalletErrorDetails) => WraithWalletError
> = {
  'not-connected': WalletNotConnectedError,
  'user-rejected': WalletUserRejectedError,
  'wrong-network': WalletWrongNetworkError,
  unavailable: WalletUnavailableError,
};

/**
 * EIP-1193 provider error codes, as surfaced by viem's RPC error classes. Solana
 * wallets such as Phantom reuse 4001, 4100 and 4900 for the same conditions.
 */
const PROVIDER_CODES = new Map<number, WalletErrorKind>([
  [4001, 'user-rejected'], // User Rejected Request (viem UserRejectedRequestError)
  [5000, 'user-rejected'], // CAIP-25 user rejection (WalletConnect); viem maps it to 4001
  [4100, 'not-connected'], // Unauthorized (viem UnauthorizedProviderError)
  [4900, 'not-connected'], // Disconnected from all chains (viem ProviderDisconnectedError)
  [4901, 'wrong-network'], // Not connected to the requested chain (viem ChainDisconnectedError)
  [4902, 'wrong-network'], // Chain not added to the wallet (viem SwitchChainError)
  [5710, 'wrong-network'], // Chain ID not supported by the wallet (viem UnsupportedChainIdError)
  [4200, 'unavailable'], // Unsupported Method (viem UnsupportedProviderMethodError)
]);

/** Errors that carry no numeric code, identified by the `name` their library assigns. */
const ERROR_NAMES = new Map<string, WalletErrorKind>([
  ['ChainMismatchError', 'wrong-network'], // viem: wallet chain differs from the action's chain
  ['AccountNotFoundError', 'not-connected'], // viem: no account to sign with
  ['WalletNotConnectedError', 'not-connected'], // @solana/wallet-adapter-base
  ['WalletDisconnectedError', 'not-connected'], // @solana/wallet-adapter-base
  ['WalletNotSelectedError', 'not-connected'], // @solana/wallet-adapter-react
  ['WalletNotReadyError', 'unavailable'], // @solana/wallet-adapter-base: not installed/loadable
  ['WalletWindowClosedError', 'user-rejected'], // @solana/wallet-adapter-base
]);

/** `FreighterApiDeclinedError.code` in `@stellar/freighter-api` 3 and later. */
const FREIGHTER_DECLINED_CODE = -4;

/**
 * Exact messages for errors that only surface as text: Freighter's error
 * constants, and the errors this SDK's reference adapters have always thrown.
 */
const MESSAGES = new Map<string, WalletErrorKind>([
  ['The user rejected this request.', 'user-rejected'], // FreighterApiDeclinedError
  ['Node environment is not supported', 'unavailable'], // FreighterApiNodeError
  ['The viem wallet client has no connected account.', 'not-connected'],
  ['The Solana wallet is not connected.', 'not-connected'],
  ['Freighter is not connected.', 'not-connected'],
  ['A viem-compatible WalletClient with signMessage is required.', 'unavailable'],
  ['A Solana wallet-adapter wallet with signMessage is required.', 'unavailable'],
  ['A Freighter-compatible wallet with signMessage and getAddress is required.', 'unavailable'],
]);

/** How many nested `cause` / `error` links to follow before giving up. */
const MAX_DEPTH = 8;

interface Classification {
  kind: WalletErrorKind;
  reason?: string;
  providerCode?: number | string;
}

/**
 * Maps any error thrown by a wallet, a wallet library or a Wraith wallet adapter
 * onto the {@link WraithWalletError} taxonomy.
 *
 * The error and its nested `cause` chain (and the `error` field that Solana
 * wallet-adapter errors use) are inspected for EIP-1193 codes, known error
 * names and Freighter's error constants. Anything unrecognised becomes a
 * {@link WalletRequestFailedError}. The original error is kept on `cause`, and a
 * `WraithWalletError` found in the chain is returned unchanged, so normalising
 * twice is safe.
 *
 * @param error - The value caught from a wallet call.
 * @param chain - Chain family of the adapter that failed, recorded on the error.
 */
export function normalizeWalletError(
  error: unknown,
  chain?: WalletAdapterChain,
): WraithWalletError {
  const seen = new Set<unknown>();
  let node: unknown = error;
  for (let depth = 0; depth < MAX_DEPTH && node != null && !seen.has(node); depth++) {
    if (node instanceof WraithWalletError) return node;
    seen.add(node);
    const match = classify(node, chain);
    if (match) {
      return new ERROR_CLASSES[match.kind]({
        chain,
        reason: match.reason,
        providerCode: match.providerCode,
        cause: error,
      });
    }
    node = next(node);
  }
  return new WalletRequestFailedError({
    chain,
    reason: readMessage(error),
    providerCode: readProviderCode(error),
    cause: error,
  });
}

/**
 * Wraps an adapter so that `signMessage`, `getAddress` and (when present)
 * `getNetwork` reject with {@link WraithWalletError}s from
 * {@link normalizeWalletError} instead of provider-specific errors.
 *
 * The wrapped adapter is a new object; the original keeps its behaviour.
 */
export function withNormalizedWalletErrors(adapter: StellarWalletAdapter): StellarWalletAdapter;
export function withNormalizedWalletErrors(adapter: EvmWalletAdapter): EvmWalletAdapter;
export function withNormalizedWalletErrors(
  adapter: SolanaChainWalletAdapter,
): SolanaChainWalletAdapter;
export function withNormalizedWalletErrors(adapter: WalletAdapter): WalletAdapter;
export function withNormalizedWalletErrors(adapter: WalletAdapter): WalletAdapter {
  const { chain } = adapter;
  const normalized = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      throw normalizeWalletError(error, chain);
    }
  };
  const wrapped = {
    chain,
    signMessage: (message: Uint8Array) =>
      normalized<Uint8Array | HexString>(() => adapter.signMessage(message)),
    getAddress: () => normalized(() => adapter.getAddress()),
  } as WalletAdapter;
  if (typeof adapter.getNetwork === 'function') {
    wrapped.getNetwork = () => normalized(() => adapter.getNetwork!());
  }
  return wrapped;
}

function classify(
  node: unknown,
  chain: WalletAdapterChain | undefined,
): Classification | undefined {
  if (typeof node === 'string') {
    const kind = MESSAGES.get(node);
    return kind && { kind, reason: node };
  }
  if (typeof node !== 'object' || node === null) return undefined;

  const { code, name, message } = node as { code?: unknown; name?: unknown; message?: unknown };
  const reason = readMessage(node);
  if (typeof code === 'number') {
    const kind =
      PROVIDER_CODES.get(code) ??
      (code === FREIGHTER_DECLINED_CODE && (chain === undefined || chain === 'stellar')
        ? 'user-rejected'
        : undefined);
    if (kind) return { kind, reason, providerCode: code };
  }
  if (typeof name === 'string') {
    const kind = ERROR_NAMES.get(name);
    if (kind) return { kind, reason, providerCode: name };
  }
  if (typeof message === 'string') {
    const kind = MESSAGES.get(message);
    if (kind)
      return { kind, reason: message, providerCode: typeof code === 'number' ? code : undefined };
  }
  return undefined;
}

function next(node: unknown): unknown {
  if (typeof node !== 'object' || node === null) return undefined;
  const { cause, error } = node as { cause?: unknown; error?: unknown };
  return cause ?? error;
}

function readMessage(node: unknown): string | undefined {
  if (typeof node === 'string') return node || undefined;
  if (typeof node !== 'object' || node === null) return undefined;
  // viem errors put a one-line summary in `shortMessage`; `message` adds docs and version lines.
  const { shortMessage, message } = node as { shortMessage?: unknown; message?: unknown };
  if (typeof shortMessage === 'string' && shortMessage) return shortMessage;
  if (typeof message === 'string' && message) return message;
  return undefined;
}

function readProviderCode(node: unknown): number | string | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const { code, name } = node as { code?: unknown; name?: unknown };
  if (typeof code === 'number' || typeof code === 'string') return code;
  if (typeof name === 'string' && name !== 'Error') return name;
  return undefined;
}
