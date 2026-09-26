import { getAddress as checksumEvmAddress } from 'viem';
import { WalletNotConnectedError } from '../errors';
import type { WalletAdapterChain } from './adapter';
import { normalizeWalletError } from './errors';
import { toEvmNetwork } from './network';

/**
 * A wallet state change, in the same shape for every provider.
 *
 * - `accountChanged`: the active account is now `address` (EIP-55 checksummed
 *   for EVM, base58 for Solana, a `G...` key for Stellar).
 * - `networkChanged`: the wallet is now on `network` (`eip155:<chainId>` for
 *   EVM, the network passphrase for Stellar).
 * - `disconnect`: the wallet disconnected or no longer exposes an account.
 */
export type WalletEvent =
  | {
      readonly type: 'accountChanged';
      readonly chain: WalletAdapterChain;
      readonly address: string;
    }
  | {
      readonly type: 'networkChanged';
      readonly chain: WalletAdapterChain;
      readonly network: string;
    }
  | {
      readonly type: 'disconnect';
      readonly chain: WalletAdapterChain;
      readonly error: WalletNotConnectedError;
    };

/** Receives normalised {@link WalletEvent}s. */
export type WalletEventListener = (event: WalletEvent) => void;

/** Event surface of an EIP-1193 provider, such as `window.ethereum`. */
export interface Eip1193EventProvider {
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
}

/** Event surface of an `@solana/wallet-adapter` adapter. */
export interface SolanaWalletEventEmitter {
  on(event: 'connect' | 'disconnect', listener: (...args: any[]) => void): unknown;
  off(event: 'connect' | 'disconnect', listener: (...args: any[]) => void): unknown;
}

/** Freighter's `WatchWalletChanges` poller (`@stellar/freighter-api` 3 and later). */
export interface FreighterWalletWatcher {
  watch(
    callback: (state: {
      address: string;
      network: string;
      networkPassphrase: string;
      error?: unknown;
    }) => void,
  ): unknown;
  stop(): void;
}

/**
 * Where {@link watchWalletEvents} listens: the EIP-1193 provider behind a viem
 * WalletClient, an `@solana/wallet-adapter` adapter, or a Freighter watcher.
 */
export type WalletEventSource =
  | { readonly chain: 'evm'; readonly provider: Eip1193EventProvider }
  | { readonly chain: 'solana'; readonly wallet: SolanaWalletEventEmitter }
  | { readonly chain: 'stellar'; readonly watcher: FreighterWalletWatcher };

interface Reporter {
  account(address: string): void;
  network(network: string): void;
  disconnect(providerError?: unknown): void;
}

/**
 * Subscribes to account, network and disconnect changes from a wallet provider
 * and reports them as normalised {@link WalletEvent}s.
 *
 * Repeated reports of the same account or network are dropped. After a
 * `disconnect`, the next account and network the wallet reports are emitted
 * again. Freighter's watcher polls, so its first poll reports the current state.
 *
 * @returns A function that stops listening.
 * @throws The normalised wallet error if a Freighter watcher cannot start.
 */
export function watchWalletEvents(
  source: WalletEventSource,
  listener: WalletEventListener,
): () => void {
  const { chain } = source;
  let active = true;
  let lastAddress: string | null | undefined;
  let lastNetwork: string | undefined;

  const reporter: Reporter = {
    account(address) {
      if (!active || address === lastAddress) return;
      lastAddress = address;
      listener({ type: 'accountChanged', chain, address });
    },
    network(network) {
      if (!active || network === lastNetwork) return;
      lastNetwork = network;
      listener({ type: 'networkChanged', chain, network });
    },
    disconnect(providerError) {
      if (!active || lastAddress === null) return;
      lastAddress = null;
      lastNetwork = undefined;
      listener({ type: 'disconnect', chain, error: disconnectError(chain, providerError) });
    },
  };

  let stop: () => void;
  switch (source.chain) {
    case 'evm':
      stop = watchEip1193(source.provider, reporter);
      break;
    case 'solana':
      stop = watchSolana(source.wallet, reporter);
      break;
    case 'stellar':
      stop = watchFreighter(source.watcher, reporter);
      break;
    default:
      throw new TypeError(`Unsupported wallet event source chain: ${String(chain)}`);
  }
  return () => {
    if (!active) return;
    active = false;
    stop();
  };
}

function watchEip1193(provider: Eip1193EventProvider, report: Reporter): () => void {
  if (typeof provider?.on !== 'function' || typeof provider.removeListener !== 'function') {
    throw new TypeError('An EIP-1193 provider with on and removeListener is required.');
  }
  const handlers: Record<string, (...args: any[]) => void> = {
    accountsChanged: (accounts: unknown) => {
      if (!Array.isArray(accounts)) return;
      if (accounts.length === 0) return report.disconnect();
      if (typeof accounts[0] === 'string' && accounts[0]) {
        report.account(checksumOrRaw(accounts[0]));
      }
    },
    chainChanged: (chainId: unknown) => {
      const network = toEvmNetwork(chainId);
      if (network) report.network(network);
    },
    connect: (info: unknown) => {
      const network = toEvmNetwork((info as { chainId?: unknown } | null | undefined)?.chainId);
      if (network) report.network(network);
    },
    disconnect: (error: unknown) => report.disconnect(error),
  };
  for (const [event, handler] of Object.entries(handlers)) provider.on(event, handler);
  return () => {
    for (const [event, handler] of Object.entries(handlers)) {
      provider.removeListener(event, handler);
    }
  };
}

function watchSolana(wallet: SolanaWalletEventEmitter, report: Reporter): () => void {
  if (typeof wallet?.on !== 'function' || typeof wallet.off !== 'function') {
    throw new TypeError('A Solana wallet-adapter wallet with on and off is required.');
  }
  // Wallet adapters re-emit `connect` with the new public key when the account changes.
  const onConnect = (publicKey: unknown) => {
    const address = toBase58(publicKey);
    if (address) report.account(address);
  };
  const onDisconnect = () => report.disconnect();
  wallet.on('connect', onConnect);
  wallet.on('disconnect', onDisconnect);
  return () => {
    wallet.off('connect', onConnect);
    wallet.off('disconnect', onDisconnect);
  };
}

function watchFreighter(watcher: FreighterWalletWatcher, report: Reporter): () => void {
  if (typeof watcher?.watch !== 'function' || typeof watcher.stop !== 'function') {
    throw new TypeError('A Freighter WatchWalletChanges instance is required.');
  }
  const started = watcher.watch((state) => {
    // A failed poll says nothing reliable about the wallet's state.
    if (!state || state.error) return;
    // Freighter reports an empty address when this site has no access.
    if (!state.address) report.disconnect();
    if (state.networkPassphrase) report.network(state.networkPassphrase);
    if (state.address) report.account(state.address);
  });
  const startError = (started as { error?: unknown } | null | undefined)?.error;
  if (startError) {
    watcher.stop();
    throw normalizeWalletError(startError, 'stellar');
  }
  return () => watcher.stop();
}

function disconnectError(
  chain: WalletAdapterChain,
  providerError: unknown,
): WalletNotConnectedError {
  const { code, message } =
    typeof providerError === 'object' && providerError !== null
      ? (providerError as { code?: unknown; message?: unknown })
      : {};
  return new WalletNotConnectedError({
    chain,
    reason: typeof message === 'string' && message ? message : 'The wallet disconnected.',
    providerCode: typeof code === 'number' || typeof code === 'string' ? code : undefined,
    cause: providerError,
  });
}

function checksumOrRaw(address: string): string {
  try {
    return checksumEvmAddress(address);
  } catch {
    return address;
  }
}

function toBase58(publicKey: unknown): string | undefined {
  if (typeof publicKey === 'string') return publicKey || undefined;
  const encode = (publicKey as { toBase58?: () => unknown } | null | undefined)?.toBase58;
  if (typeof encode !== 'function') return undefined;
  const address = encode.call(publicKey);
  return typeof address === 'string' && address ? address : undefined;
}
