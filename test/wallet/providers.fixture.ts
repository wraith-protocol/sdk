/**
 * Mock wallet providers for the wallet adapter tests. No real wallet or network
 * is used. Each mock reproduces the error and event shapes of the published
 * library it stands in for; the version each shape was copied from is noted.
 */
import { PublicKey } from '@solana/web3.js';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { getAddress } from 'viem';

/** Minimal eventemitter3-style emitter: emitting 'error' with no listener does not throw. */
export class Emitter {
  private readonly listeners = new Map<string, Set<(...args: any[]) => void>>();

  on(event: string, listener: (...args: any[]) => void): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return this;
  }

  off(event: string, listener: (...args: any[]) => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  removeListener(event: string, listener: (...args: any[]) => void): this {
    return this.off(event, listener);
  }

  emit(event: string, ...args: unknown[]): boolean {
    const listeners = [...(this.listeners.get(event) ?? [])];
    for (const listener of listeners) listener(...args);
    return listeners.length > 0;
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

// ---------------------------------------------------------------------------
// EIP-1193 (the provider behind a viem WalletClient)
// ---------------------------------------------------------------------------

export const EVM_ACCOUNTS = [
  '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
  '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
] as const;
/** Accounts as viem's `getAddresses()` returns them (EIP-55 checksummed). */
export const EVM_CHECKSUMMED = EVM_ACCOUNTS.map((account) => getAddress(account));
export const EVM_SIGNATURE = `0x${'22'.repeat(65)}` as const;

/** An EIP-1193 `ProviderRpcError`: an Error with a numeric `code`. */
export function providerRpcError(code: number, message: string): Error & { code: number } {
  return Object.assign(new Error(message), { code });
}

/** EIP-1193 provider with MetaMask-style behaviour. */
export class MockEip1193Provider extends Emitter {
  accounts: string[] = [];
  chainId = '0x1';
  declineConnection = false;
  pendingAccount: string = EVM_ACCOUNTS[0];
  private readonly failures = new Map<string, Error>();

  /** Makes the next request for `method` reject with `error`. */
  failNext(method: string, error: Error): void {
    this.failures.set(method, error);
  }

  async request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
    const failure = this.failures.get(method);
    if (failure) {
      this.failures.delete(method);
      throw failure;
    }
    switch (method) {
      case 'eth_accounts':
        return [...this.accounts];
      case 'eth_chainId':
        return this.chainId;
      case 'eth_requestAccounts':
        if (this.declineConnection) throw providerRpcError(4001, 'User rejected the request.');
        this.setAccounts([this.pendingAccount]);
        return [...this.accounts];
      case 'personal_sign': {
        const signer = String(params?.[1] ?? '').toLowerCase();
        if (!this.accounts.includes(signer)) {
          throw providerRpcError(
            4100,
            'The requested account and/or method has not been authorized by the user.',
          );
        }
        return EVM_SIGNATURE;
      }
      default:
        throw providerRpcError(4200, 'The Provider does not support the requested method.');
    }
  }

  setAccounts(accounts: string[]): void {
    this.accounts = accounts;
    this.emit('accountsChanged', [...accounts]);
  }

  setChain(chainId: string): void {
    this.chainId = chainId;
    this.emit('chainChanged', chainId);
  }
}

// ---------------------------------------------------------------------------
// @solana/wallet-adapter
// ---------------------------------------------------------------------------

/** Copied from `@solana/wallet-adapter-base@0.9.28` `lib/esm/errors.js`. */
export class WalletError extends Error {
  error: any;

  constructor(message?: string, error?: any) {
    super(message);
    this.error = error;
  }
}
export class WalletNotReadyError extends WalletError {
  name = 'WalletNotReadyError';
}
export class WalletConnectionError extends WalletError {
  name = 'WalletConnectionError';
}
export class WalletDisconnectedError extends WalletError {
  name = 'WalletDisconnectedError';
}
export class WalletNotConnectedError extends WalletError {
  name = 'WalletNotConnectedError';
}
export class WalletSignMessageError extends WalletError {
  name = 'WalletSignMessageError';
}
export class WalletTimeoutError extends WalletError {
  name = 'WalletTimeoutError';
}
export class WalletWindowClosedError extends WalletError {
  name = 'WalletWindowClosedError';
}
/** Copied from `@solana/wallet-adapter-react@0.15.40` `lib/esm/errors.js`. */
export class WalletNotSelectedError extends WalletError {
  name = 'WalletNotSelectedError';
}

export const SOLANA_KEYS = [
  new PublicKey(new Uint8Array(32).fill(7)),
  new PublicKey(new Uint8Array(32).fill(9)),
] as const;
export const SOLANA_SIGNATURE = new Uint8Array(64).fill(0x33);

/** Phantom's documented error for a declined request, as an injected-provider error. */
const phantomRejection = () => ({ code: 4001, message: 'User rejected the request.' });

/**
 * Wallet adapter that behaves like `PhantomWalletAdapter` in
 * `@solana/wallet-adapter-phantom@0.9.30`: provider errors are wrapped in
 * `WalletConnectionError` / `WalletSignMessageError` with the original on
 * `.error`, and an account switch is re-emitted as `connect`.
 */
export class MockSolanaWallet extends Emitter {
  publicKey: PublicKey | null = null;
  readyState: 'Installed' | 'NotDetected' = 'Installed';
  declineConnection = false;
  pendingKey: PublicKey = SOLANA_KEYS[0];
  private rejectNextSign = false;

  async connect(): Promise<void> {
    try {
      if (this.readyState !== 'Installed') throw new WalletNotReadyError();
      if (this.declineConnection) {
        const error = phantomRejection();
        throw new WalletConnectionError(error.message, error);
      }
      this.publicKey = this.pendingKey;
      this.emit('connect', this.publicKey);
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.publicKey = null;
    this.emit('disconnect');
  }

  switchAccount(publicKey: PublicKey): void {
    this.publicKey = publicKey;
    this.emit('connect', publicKey);
  }

  rejectNextSignature(): void {
    this.rejectNextSign = true;
  }

  async signMessage(_message: Uint8Array): Promise<Uint8Array> {
    try {
      if (!this.publicKey) throw new WalletNotConnectedError();
      if (this.rejectNextSign) {
        this.rejectNextSign = false;
        const error = phantomRejection();
        throw new WalletSignMessageError(error.message, error);
      }
      return SOLANA_SIGNATURE;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Freighter
// ---------------------------------------------------------------------------

/** Copied from `@stellar/freighter-api@6.0.1` `@shared/api/helpers/extensionMessaging.ts`. */
export const FreighterApiNodeError = {
  code: -1,
  message: 'Node environment is not supported',
};
export const FreighterApiInternalError = {
  code: -1,
  message:
    'The wallet encountered an internal error. Please try again or contact the wallet if the problem persists.',
};
export const FreighterApiDeclinedError = {
  code: -4,
  message: 'The user rejected this request.',
};

export const STELLAR_ACCOUNTS = [
  Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey(),
  Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey(),
] as const;
export const STELLAR_NETWORKS = [Networks.TESTNET, Networks.PUBLIC] as const;
export const STELLAR_SIGNATURE = new Uint8Array(64).fill(0x11);

/**
 * `@stellar/freighter-api@6.0.1` behaviour: results carry `{ error }` instead
 * of throwing, a site without access gets an empty address, and
 * `signMessage` asks for access first when the site is not allowed.
 */
export class MockFreighter {
  environment: 'browser' | 'node' = 'browser';
  allowed = false;
  declineAccess = false;
  address: string = STELLAR_ACCOUNTS[0];
  network = 'TESTNET';
  networkPassphrase: string = STELLAR_NETWORKS[0];
  private rejectNextSign = false;

  rejectNextSignature(): void {
    this.rejectNextSign = true;
  }

  async getAddress(): Promise<{ address: string; error?: { code: number; message: string } }> {
    if (this.environment === 'node') return { address: '', error: FreighterApiNodeError };
    return { address: this.allowed ? this.address : '' };
  }

  async requestAccess(): Promise<{ address: string; error?: { code: number; message: string } }> {
    if (this.environment === 'node') return { address: '', error: FreighterApiNodeError };
    if (this.declineAccess) return { address: '', error: FreighterApiDeclinedError };
    this.allowed = true;
    return { address: this.address };
  }

  async signMessage(_message: string): Promise<{
    signedMessage: string | null;
    signerAddress: string;
    error?: { code: number; message: string };
  }> {
    if (this.environment === 'node') {
      return { signedMessage: null, signerAddress: '', error: FreighterApiNodeError };
    }
    if (!this.allowed) {
      const access = await this.requestAccess();
      if (access.error) return { signedMessage: null, signerAddress: '', error: access.error };
    }
    if (this.rejectNextSign) {
      this.rejectNextSign = false;
      return { signedMessage: null, signerAddress: '', error: FreighterApiDeclinedError };
    }
    // API version 4+ receives the signature base64-encoded.
    return {
      signedMessage: Buffer.from(STELLAR_SIGNATURE).toString('base64'),
      signerAddress: this.address,
    };
  }

  async getNetwork(): Promise<{
    network: string;
    networkPassphrase: string;
    error?: { code: number; message: string };
  }> {
    if (this.environment === 'node') {
      return { network: '', networkPassphrase: '', error: FreighterApiNodeError };
    }
    return { network: this.network, networkPassphrase: this.networkPassphrase };
  }
}

/**
 * `WatchWalletChanges` from `@stellar/freighter-api@6.0.1`: `watch()` returns
 * `{ error }` outside a browser, and each poll calls back only when the
 * address, network or passphrase changed. Tests drive polls with `poll()`.
 */
export class MockFreighterWatcher {
  stopped = false;
  private callback?: (state: {
    address: string;
    network: string;
    networkPassphrase: string;
    error?: unknown;
  }) => void;
  private current = { address: '', network: '', networkPassphrase: '' };

  constructor(private readonly freighter: MockFreighter) {}

  watch(callback: NonNullable<MockFreighterWatcher['callback']>): { error?: unknown } {
    if (this.freighter.environment === 'node') return { error: FreighterApiNodeError };
    this.callback = callback;
    this.stopped = false;
    return {};
  }

  stop(): void {
    this.stopped = true;
  }

  /** One polling tick. */
  poll(): void {
    if (this.stopped || !this.callback) return;
    const next = {
      address: this.freighter.allowed ? this.freighter.address : '',
      network: this.freighter.network,
      networkPassphrase: this.freighter.networkPassphrase,
    };
    if (
      next.address !== this.current.address ||
      next.network !== this.current.network ||
      next.networkPassphrase !== this.current.networkPassphrase
    ) {
      this.current = next;
      this.callback({ ...next });
    }
  }

  /** A poll whose extension request failed, as `WatchWalletChanges` reports it. */
  pollWithError(error: unknown): void {
    this.callback?.({ address: '', network: '', networkPassphrase: '', error });
  }
}
