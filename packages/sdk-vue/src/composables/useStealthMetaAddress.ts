import { ref, readonly } from 'vue';
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

export function useStealthMetaAddress() {
  const encoded = ref<string | null>(null);
  const decoded = ref<AnyStealthMetaAddress | null>(null);
  const chain = ref<ChainType>('evm');
  const error = ref<string | null>(null);

  function getPrefix(chainType: ChainType): string {
    return CHAIN_PREFIXES[chainType];
  }

  function setChain(chainType: ChainType) {
    chain.value = chainType;
  }

  function encode(
    spendingPubKey: HexString | Uint8Array,
    viewingPubKey: HexString | Uint8Array,
    chainType?: ChainType,
  ): string {
    error.value = null;
    const c = chainType ?? chain.value;
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
      }
      encoded.value = result;
      chain.value = c;
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Encoding failed';
      error.value = msg;
      throw e;
    }
  }

  function decode(address: string): AnyStealthMetaAddress {
    error.value = null;
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
      }
      decoded.value = result;
      chain.value = c;
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Decoding failed';
      error.value = msg;
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
    encoded: readonly(encoded),
    decoded: readonly(decoded),
    chain: readonly(chain),
    error: readonly(error),
    setChain,
    encode,
    decode,
    detectChain,
    getPrefix,
    CHAIN_PREFIXES,
  };
}
