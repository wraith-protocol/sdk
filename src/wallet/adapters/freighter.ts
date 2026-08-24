import type { StellarWalletAdapter } from '../adapter';

/** Minimal Freighter API surface used by the adapter. */
export interface FreighterWalletApi {
  signMessage(message: string): Promise<{
    signedMessage?: Uint8Array | string;
    error?: string | { message?: string };
  }>;
  getAddress(): Promise<string | { address?: string; error?: string | { message?: string } }>;
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
