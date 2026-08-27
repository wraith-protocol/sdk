import { STEALTH_SIGNING_MESSAGE as EVM_SIGNING_MESSAGE } from '../chains/evm/constants';
import { deriveStealthKeys as deriveEvmStealthKeys } from '../chains/evm/keys';
import type { HexString, StealthKeys as EvmStealthKeys } from '../chains/evm/types';
import { STEALTH_SIGNING_MESSAGE as SOLANA_SIGNING_MESSAGE } from '../chains/solana/constants';
import { deriveStealthKeys as deriveSolanaStealthKeys } from '../chains/solana/keys';
import type { StealthKeys as SolanaStealthKeys } from '../chains/solana/types';
import { STEALTH_SIGNING_MESSAGE as STELLAR_SIGNING_MESSAGE } from '../chains/stellar/constants';
import { deriveStealthKeys as deriveStellarStealthKeys } from '../chains/stellar/keys';
import type { StealthKeys as StellarStealthKeys } from '../chains/stellar/types';

/** Chains supported by the unified wallet adapter. */
export type WalletAdapterChain = 'stellar' | 'evm' | 'solana';

/** Common wallet capabilities used by cross-chain applications. */
export interface BaseWalletAdapter<TChain extends WalletAdapterChain, TSignature> {
  readonly chain: TChain;
  signMessage(message: Uint8Array): Promise<TSignature>;
  getAddress(): Promise<string>;
}

/** Wallet adapter for Stellar-compatible ed25519 wallets. */
export type StellarWalletAdapter = BaseWalletAdapter<'stellar', Uint8Array>;

/** Wallet adapter for EVM wallets returning a 65-byte hex signature. */
export type EvmWalletAdapter = BaseWalletAdapter<'evm', HexString>;

/** Wallet adapter for Solana-compatible ed25519 wallets. */
export type SolanaChainWalletAdapter = BaseWalletAdapter<'solana', Uint8Array>;

/** Discriminated union accepted by the unified wallet registry and derivation router. */
export type WalletAdapter = StellarWalletAdapter | EvmWalletAdapter | SolanaChainWalletAdapter;

export function deriveStealthKeysFromWallet(
  adapter: StellarWalletAdapter,
): Promise<StellarStealthKeys>;
export function deriveStealthKeysFromWallet(adapter: EvmWalletAdapter): Promise<EvmStealthKeys>;
export function deriveStealthKeysFromWallet(
  adapter: SolanaChainWalletAdapter,
): Promise<SolanaStealthKeys>;
export function deriveStealthKeysFromWallet(
  adapter: WalletAdapter,
): Promise<StellarStealthKeys | EvmStealthKeys | SolanaStealthKeys>;

/**
 * Signs the chain-specific Wraith derivation message and routes the signature
 * through that chain's existing stealth-key derivation implementation.
 */
export async function deriveStealthKeysFromWallet(
  adapter: WalletAdapter,
): Promise<StellarStealthKeys | EvmStealthKeys | SolanaStealthKeys> {
  switch (adapter.chain) {
    case 'stellar': {
      const signature = await adapter.signMessage(encode(STELLAR_SIGNING_MESSAGE));
      return deriveStellarStealthKeys(signature);
    }
    case 'evm': {
      const signature = await adapter.signMessage(encode(EVM_SIGNING_MESSAGE));
      return deriveEvmStealthKeys(signature);
    }
    case 'solana': {
      const signature = await adapter.signMessage(encode(SOLANA_SIGNING_MESSAGE));
      return deriveSolanaStealthKeys(signature);
    }
  }
}

function encode(message: string): Uint8Array {
  return new TextEncoder().encode(message);
}
