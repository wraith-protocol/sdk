import { createSignal } from 'solid-js';
import {
  encodeStealthMetaAddress as evmEncode,
  decodeStealthMetaAddress as evmDecode,
  META_ADDRESS_PREFIX as EVM_PREFIX,
} from '@wraith-protocol/sdk/chains/evm';
import {
  encodeStealthMetaAddress as stellarEncode,
  decodeStealthMetaAddress as stellarDecode,
  META_ADDRESS_PREFIX as STELLAR_PREFIX,
} from '@wraith-protocol/sdk/chains/stellar';
import {
  encodeStealthMetaAddress as solanaEncode,
  decodeStealthMetaAddress as solanaDecode,
  META_ADDRESS_PREFIX as SOLANA_PREFIX,
} from '@wraith-protocol/sdk/chains/solana';
import type { HexString } from '@wraith-protocol/sdk/chains/evm';
import type { StealthMetaAddress as EvmMetaAddress } from '@wraith-protocol/sdk/chains/evm';
import type { StealthMetaAddress as StellarMetaAddress } from '@wraith-protocol/sdk/chains/stellar';

export type ChainType = 'evm' | 'stellar' | 'solana';

type AnyStealthMetaAddress = EvmMetaAddress | StellarMetaAddress;

const CHAIN_PREFIXES: Record<ChainType, string> = {
  evm: EVM_PREFIX,
  stellar: STELLAR_PREFIX,
  solana: SOLANA_PREFIX,
};

/**
 * Solid primitive for encoding and decoding stealth meta-addresses across
 * EVM, Stellar, and Solana chains.
 *
 * All reactive values are returned as getter functions following Solid conventions.
 */
export function createMetaAddress() {
  const [encoded, setEncoded] = createSignal<string | null>(null);
  const [decoded, setDecoded] = createSignal<AnyStealthMetaAddress | null>(null);
  const [chain, setChain] = createSignal<ChainType>('evm');
  const [error, setError] = createSignal<string | null>(null);

  function getPrefix(chainType: ChainType): string {
    return CHAIN_PREFIXES[chainType];
  }

  function selectChain(chainType: ChainType): void {
    setChain(chainType);
  }

  function encode(
    spendingPubKey: HexString | Uint8Array,
    viewingPubKey: HexString | Uint8Array,
    chainType?: ChainType,
  ): string {
    setError(null);
    const c = chainType ?? chain();
    try {
      let result: string;
      switch (c) {
        case 'evm':
          result = evmEncode(spendingPubKey as `0x${string}`, viewingPubKey as `0x${string}`);
          break;
        case 'stellar':
          result = stellarEncode(spendingPubKey as Uint8Array, viewingPubKey as Uint8Array);
          break;
        case 'solana':
          result = solanaEncode(spendingPubKey as Uint8Array, viewingPubKey as Uint8Array);
          break;
        default: {
          const _exhaustive: never = c;
          throw new Error(`Unknown chain: ${_exhaustive}`);
        }
      }
      setEncoded(result);
      setChain(c);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Encoding failed');
      throw e;
    }
  }

  function decode(address: string): AnyStealthMetaAddress {
    setError(null);
    try {
      const c = detectChain(address);
      let result: AnyStealthMetaAddress;
      switch (c) {
        case 'evm':
          result = evmDecode(address);
          break;
        case 'stellar':
          result = stellarDecode(address);
          break;
        case 'solana':
          result = solanaDecode(address);
          break;
        default: {
          const _exhaustive: never = c;
          throw new Error(`Unknown chain: ${_exhaustive}`);
        }
      }
      setDecoded(() => result);
      setChain(c);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Decoding failed');
      throw e;
    }
  }

  function detectChain(address: string): ChainType {
    if (address.startsWith(EVM_PREFIX)) return 'evm';
    if (address.startsWith(STELLAR_PREFIX)) return 'stellar';
    if (address.startsWith(SOLANA_PREFIX)) return 'solana';
    throw new Error(`Unknown meta address prefix: ${address.slice(0, 10)}...`);
  }

  return {
    // Reactive getters (Solid signal accessors)
    encoded,
    decoded,
    chain,
    error,
    // Actions
    selectChain,
    encode,
    decode,
    detectChain,
    getPrefix,
    CHAIN_PREFIXES,
  };
}

export type { AnyStealthMetaAddress };
