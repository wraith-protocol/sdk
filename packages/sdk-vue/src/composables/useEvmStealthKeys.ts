import { ref, readonly } from 'vue';
import {
  deriveStealthKeys as evmDeriveKeys,
  generateStealthAddress as evmGenerateAddress,
  checkStealthAddress as evmCheckAddress,
  scanAnnouncements as evmScan,
  deriveStealthPrivateKey,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  fetchAnnouncements,
  type HexString,
  type StealthKeys,
  type GeneratedStealthAddress,
  type Announcement,
  type MatchedAnnouncement,
  type StealthMetaAddress,
} from '@wraith-protocol/sdk/chains/evm';

export function useEvmStealthKeys() {
  const keys = ref<StealthKeys | null>(null);
  const stealthAddress = ref<GeneratedStealthAddress | null>(null);
  const announcements = ref<Announcement[]>([]);
  const matched = ref<MatchedAnnouncement[]>([]);
  const metaAddress = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  function deriveKeys(signature: HexString): StealthKeys {
    loading.value = true;
    error.value = null;
    try {
      const k = evmDeriveKeys(signature);
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
    spendingPubKey: HexString,
    viewingPubKey: HexString,
    ephemeralPrivateKey?: HexString,
  ): GeneratedStealthAddress {
    loading.value = true;
    error.value = null;
    try {
      const addr = evmGenerateAddress(spendingPubKey, viewingPubKey, ephemeralPrivateKey);
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
    ephemeralPubKey: HexString,
    viewingKey: HexString,
    spendingPubKey: HexString,
    viewTag: number,
  ) {
    loading.value = true;
    error.value = null;
    try {
      return evmCheckAddress(ephemeralPubKey, viewingKey, spendingPubKey, viewTag);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Address check failed';
      error.value = msg;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  function derivePrivateKey(
    spendingKey: HexString,
    ephemeralPubKey: HexString,
    viewingKey: HexString,
  ): HexString {
    loading.value = true;
    error.value = null;
    try {
      return deriveStealthPrivateKey(spendingKey, ephemeralPubKey, viewingKey);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Private key derivation failed';
      error.value = msg;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  function encodeMetaAddress(spendingPubKey: HexString, viewingPubKey: HexString): string {
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

  async function fetchAnnouncementsList(
    chain: string,
    subgraphUrl?: string,
  ): Promise<Announcement[]> {
    loading.value = true;
    error.value = null;
    try {
      const list = await fetchAnnouncements(chain, subgraphUrl);
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
    viewingKey: HexString,
    spendingPubKey: HexString,
    spendingKey: HexString,
  ): MatchedAnnouncement[] {
    loading.value = true;
    error.value = null;
    try {
      const result = evmScan(announcementsList, viewingKey, spendingPubKey, spendingKey);
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
    derivePrivateKey,
    encodeMetaAddress,
    decodeMetaAddress,
    fetchAnnouncements: fetchAnnouncementsList,
    scanAnnouncements,
  };
}
