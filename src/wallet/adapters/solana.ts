import type { SolanaChainWalletAdapter } from '../adapter';

/** Structural subset exposed by `@solana/wallet-adapter` wallets. */
export interface SolanaWalletAdapterLike {
  publicKey: { toBase58(): string } | null;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
}

/** `@solana/wallet-adapter` reference adapter with no package import. */
export class SolanaWalletAdapter implements SolanaChainWalletAdapter {
  readonly chain = 'solana' as const;

  constructor(private readonly wallet: SolanaWalletAdapterLike) {
    if (!wallet || typeof wallet.signMessage !== 'function') {
      throw new TypeError('A Solana wallet-adapter wallet with signMessage is required.');
    }
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    return this.wallet.signMessage!(message);
  }

  async getAddress(): Promise<string> {
    if (!this.wallet.publicKey) throw new Error('The Solana wallet is not connected.');
    return this.wallet.publicKey.toBase58();
  }
}

/** Creates a unified adapter from an `@solana/wallet-adapter` wallet. */
export function createSolanaWalletAdapter(wallet: SolanaWalletAdapterLike): SolanaWalletAdapter {
  return new SolanaWalletAdapter(wallet);
}
