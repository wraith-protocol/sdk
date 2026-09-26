import { WalletUnavailableError } from '../../errors';
import type { StellarWalletAdapter } from '../adapter';
import { normalizeWalletError } from '../errors';

/** Minimal Freighter API surface used by the adapter. */
export interface FreighterWalletApi {
  signMessage(message: string): Promise<{
    signedMessage?: Uint8Array | string;
    error?: string | { message?: string };
  }>;
  getAddress(): Promise<string | { address?: string; error?: string | { message?: string } }>;
  /** Used by `getNetwork()`; available in `@stellar/freighter-api` 3 and later. */
  getNetwork?(): Promise<{
    network?: string;
    networkPassphrase?: string;
    error?: string | { code?: number; message?: string };
  }>;
}

/** Freighter reference adapter with no dependency on `@stellar/freighter-api`. */
export class FreighterWalletAdapter implements StellarWalletAdapter {
  readonly chain = 'stellar' as const;

  constructor(private readonly wallet: FreighterWalletApi) {
    if (
      !wallet ||
      typeof wallet.signMessage !== 'function' ||
      typeof wallet.getAddress !== 'function'
    ) {
      throw new TypeError(
        'A Freighter-compatible wallet with signMessage and getAddress is required.',
      );
    }
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const result = await this.wallet.signMessage(new TextDecoder().decode(message));
    if (!result.signedMessage)
      throw new Error(readError(result.error, 'Freighter did not sign the message.'));
    return typeof result.signedMessage === 'string'
      ? decodeBase64(result.signedMessage)
      : result.signedMessage;
  }

  async getAddress(): Promise<string> {
    const result = await this.wallet.getAddress();
    if (typeof result === 'string') return result;
    if (!result.address) throw new Error(readError(result.error, 'Freighter is not connected.'));
    return result.address;
  }

  /**
   * Returns the network passphrase Freighter is currently using.
   *
   * Unlike `signMessage` and `getAddress`, this method rejects with normalised
   * `WraithWalletError`s.
   */
  async getNetwork(): Promise<string> {
    if (typeof this.wallet.getNetwork !== 'function') {
      throw new WalletUnavailableError({
        chain: 'stellar',
        reason: 'The Freighter API object does not provide getNetwork().',
      });
    }
    const result = await Promise.resolve()
      .then(() => this.wallet.getNetwork!())
      .catch((error: unknown) => {
        throw normalizeWalletError(error, 'stellar');
      });
    if (result.error || !result.networkPassphrase) {
      throw normalizeWalletError(
        result.error ?? 'Freighter did not report a network passphrase.',
        'stellar',
      );
    }
    return result.networkPassphrase;
  }
}

/** Creates a unified adapter from an installed Freighter API object. */
export function createFreighterWalletAdapter(wallet: FreighterWalletApi): FreighterWalletAdapter {
  return new FreighterWalletAdapter(wallet);
}

function decodeBase64(value: string): Uint8Array {
  if (typeof globalThis.atob === 'function') {
    return Uint8Array.from(globalThis.atob(value), (character) => character.charCodeAt(0));
  }
  return new Uint8Array(Buffer.from(value, 'base64'));
}

function readError(error: string | { message?: string } | undefined, fallback: string): string {
  if (typeof error === 'string') return error;
  return error?.message ?? fallback;
}
