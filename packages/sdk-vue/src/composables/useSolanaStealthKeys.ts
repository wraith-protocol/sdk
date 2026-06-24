import { ref, readonly } from 'vue';
import {
  deriveStealthKeys as solanaDeriveKeys,
  generateStealthAddress as solanaGenerateAddress,
  checkStealthAddress as solanaCheckAddress,
  scanAnnouncements as solanaScan,
  deriveStealthPrivateScalar,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  fetchAnnouncements,
  type StealthKeys,
  type GeneratedStealthAddress,
  type Announcement,
  type MatchedAnnouncement,
  type StealthMetaAddress,
} from '@wraith-protocol/sdk/chains/solana';

export function useSolanaStealthKeys() {
  const keys = ref<StealthKeys | null>(null);
  const stealthAddress = ref<GeneratedStealthAddress | null>(null);
  const announcements = ref<Announcement[]>([]);
  const matched = ref<MatchedAnnouncement[]>([]);
  const metaAddress = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  function deriveKeys(signature: Uint8Array): StealthKeys {
    loading.value = true;
    error.value = null;
    try {
      const k = solanaDeriveKeys(signature);
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
    spendingPubKey: Uint8Array,
    viewingPubKey: Uint8Array,
    ephemeralSeed?: Uint8Array,
  ): GeneratedStealthAddress {
    loading.value = true;
    error.value = null;
    try {
      const addr = solanaGenerateAddress(spendingPubKey, viewingPubKey, ephemeralSeed);
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
    ephemeralPubKey: Uint8Array,
    viewingKey: Uint8Array,
    spendingPubKey: Uint8Array,
    viewTag: number,
  ) {
    loading.value = true;
    error.value = null;
    try {
      return solanaCheckAddress(ephemeralPubKey, viewingKey, spendingPubKey, viewTag);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Address check failed';
      error.value = msg;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  function derivePrivateScalar(
    spendingScalar: bigint,
    viewingKey: Uint8Array,
    ephemeralPubKey: Uint8Array,
  ): bigint {
    loading.value = true;
    error.value = null;
    try {
      return deriveStealthPrivateScalar(spendingScalar, viewingKey, ephemeralPubKey);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Private scalar derivation failed';
      error.value = msg;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  function encodeMetaAddress(spendingPubKey: Uint8Array, viewingPubKey: Uint8Array): string {
    try {
      const encoded = encodeStealthMetaAddress(spendingPubKey, viewingPubKey);
      metaAddress.value = encoded;
      return encoded;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Meta address encoding failed';
      error.value = msg;
      throw e;
    }
  }

  function decodeMetaAddress(address: string): StealthMetaAddress {
    loading.value = true;
    error.value = null;
    try {
      return decodeStealthMetaAddress(address);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Meta address decoding failed';
      error.value = msg;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function fetchAnnouncementsList(chain?: string, rpcUrl?: string): Promise<Announcement[]> {
    loading.value = true;
    error.value = null;
    try {
      const list = await fetchAnnouncements(chain, rpcUrl);
      announcements.value = list;
      return list;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to fetch announcements';
      error.value = msg;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  function scanAnnouncements(
    announcementsList: Announcement[],
    viewingKey: Uint8Array,
    spendingPubKey: Uint8Array,
    spendingScalar: bigint,
  ): MatchedAnnouncement[] {
    loading.value = true;
    error.value = null;
    try {
      const result = solanaScan(announcementsList, viewingKey, spendingPubKey, spendingScalar);
      matched.value = result;
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Scan failed';
      error.value = msg;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  return {
    keys: readonly(keys),
    stealthAddress: readonly(stealthAddress),
    announcements: readonly(announcements),
    matched: readonly(matched),
    metaAddress: readonly(metaAddress),
    loading: readonly(loading),
    error: readonly(error),
    deriveKeys,
    generateAddress,
    checkAddress,
    derivePrivateScalar,
    encodeMetaAddress,
    decodeMetaAddress,
    fetchAnnouncements: fetchAnnouncementsList,
    scanAnnouncements,
  };
}
