import { ref, readonly } from 'vue';
import {
  deriveStealthKeys as evmDeriveKeys,
  generateStealthAddress as evmGenerateAddress,
  checkStealthAddress as evmCheckAddress,
  deriveStealthPrivateKey,
  type HexString,
  type StealthKeys as EvmStealthKeys,
  type GeneratedStealthAddress as EvmGeneratedAddress,
} from '@wraith-protocol/sdk/chains/evm';
import {
  deriveStealthKeys as stellarDeriveKeys,
  generateStealthAddress as stellarGenerateAddress,
  checkStealthAddress as stellarCheckAddress,
  deriveStealthPrivateScalar,
  type StealthKeys as StellarStealthKeys,
  type GeneratedStealthAddress as StellarGeneratedAddress,
} from '@wraith-protocol/sdk/chains/stellar';
import {
  deriveStealthKeys as solanaDeriveKeys,
  generateStealthAddress as solanaGenerateAddress,
  checkStealthAddress as solanaCheckAddress,
  deriveStealthPrivateScalar as solanaDerivePrivateScalar,
  type StealthKeys as SolanaStealthKeys,
  type GeneratedStealthAddress as SolanaGeneratedAddress,
} from '@wraith-protocol/sdk/chains/solana';

export type StealthChain = 'evm' | 'stellar' | 'solana';

export type AnyStealthKeys = EvmStealthKeys | StellarStealthKeys | SolanaStealthKeys;
export type AnyGeneratedStealthAddress =
  | EvmGeneratedAddress
  | StellarGeneratedAddress
  | SolanaGeneratedAddress;

export function useStealthKeys(chain?: StealthChain) {
  const activeChain = ref<StealthChain>(chain ?? 'stellar');
  const keys = ref<AnyStealthKeys | null>(null);
  const stealthAddress = ref<AnyGeneratedStealthAddress | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  function setChain(c: StealthChain) {
    activeChain.value = c;
  }

  function deriveKeys(signature: Uint8Array | HexString): AnyStealthKeys {
    loading.value = true;
    error.value = null;
    try {
      let k: AnyStealthKeys;
      switch (activeChain.value) {
        case 'evm':
          k = evmDeriveKeys(signature as HexString);
          break;
        case 'stellar':
          k = stellarDeriveKeys(signature as Uint8Array);
          break;
        case 'solana':
          k = solanaDeriveKeys(signature as Uint8Array);
          break;
      }
      keys.value = k;
      return k;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Key derivation failed';
      error.value = msg;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  function generateAddress(
    spendingPubKey: Uint8Array | HexString,
    viewingPubKey: Uint8Array | HexString,
    ephemeralSeed?: Uint8Array | HexString,
  ): AnyGeneratedStealthAddress {
    loading.value = true;
    error.value = null;
    try {
      let addr: AnyGeneratedStealthAddress;
      switch (activeChain.value) {
        case 'evm':
          addr = evmGenerateAddress(
            spendingPubKey as HexString,
            viewingPubKey as HexString,
            ephemeralSeed as HexString | undefined,
          );
          break;
        case 'stellar':
          addr = stellarGenerateAddress(
            spendingPubKey as Uint8Array,
            viewingPubKey as Uint8Array,
            ephemeralSeed as Uint8Array | undefined,
          );
          break;
        case 'solana':
          addr = solanaGenerateAddress(
            spendingPubKey as Uint8Array,
            viewingPubKey as Uint8Array,
            ephemeralSeed as Uint8Array | undefined,
          );
          break;
      }
      stealthAddress.value = addr;
      return addr;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Address generation failed';
      error.value = msg;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  function checkAddress(
    ephemeralPubKey: Uint8Array | HexString,
    viewingKey: Uint8Array | HexString,
    spendingPubKey: Uint8Array | HexString,
    viewTag: number,
  ) {
    loading.value = true;
    error.value = null;
    try {
      switch (activeChain.value) {
        case 'evm':
          return evmCheckAddress(
            ephemeralPubKey as HexString,
            viewingKey as HexString,
            spendingPubKey as HexString,
            viewTag,
          );
        case 'stellar':
          return stellarCheckAddress(
            ephemeralPubKey as Uint8Array,
            viewingKey as Uint8Array,
            spendingPubKey as Uint8Array,
            viewTag,
          );
        case 'solana':
          return solanaCheckAddress(
            ephemeralPubKey as Uint8Array,
            viewingKey as Uint8Array,
            spendingPubKey as Uint8Array,
            viewTag,
          );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Address check failed';
      error.value = msg;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  function derivePrivateKey(
    spendingKey: Uint8Array | HexString | bigint,
    ephemeralPubKey: Uint8Array | HexString,
    viewingKey: Uint8Array | HexString,
  ): HexString | bigint {
    loading.value = true;
    error.value = null;
    try {
      switch (activeChain.value) {
        case 'evm':
          return deriveStealthPrivateKey(
            spendingKey as HexString,
            ephemeralPubKey as HexString,
            viewingKey as HexString,
          );
        case 'stellar':
          return deriveStealthPrivateScalar(
            spendingKey as bigint,
            viewingKey as Uint8Array,
            ephemeralPubKey as Uint8Array,
          );
        case 'solana':
          return solanaDerivePrivateScalar(
            spendingKey as bigint,
            viewingKey as Uint8Array,
            ephemeralPubKey as Uint8Array,
          );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Private key derivation failed';
      error.value = msg;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  return {
    keys: readonly(keys),
    stealthAddress: readonly(stealthAddress),
    loading: readonly(loading),
    error: readonly(error),
    chain: readonly(activeChain),
    setChain,
    deriveKeys,
    generateAddress,
    checkAddress,
    derivePrivateKey,
  };
}
