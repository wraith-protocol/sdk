import { ref, readonly } from 'vue';
import {
  deriveStealthKeys as stellarDeriveKeys,
  generateStealthAddress as stellarGenerateAddress,
  checkStealthAddress as stellarCheckAddress,
  scanAnnouncements as stellarScan,
  deriveStealthPrivateScalar,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  fetchAnnouncementsStream,
  type StealthKeys,
  type GeneratedStealthAddress,
  type Announcement,
  type MatchedAnnouncement,
  type StealthMetaAddress,
} from '@wraith-protocol/sdk/chains/stellar';

async function collectAnnouncements(stream: AsyncGenerator<Announcement>): Promise<Announcement[]> {
  const result: Announcement[] = [];
  for await (const ann of stream) result.push(ann);
  return result;
}

export function useStellarStealthKeys() {
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
      const k = stellarDeriveKeys(signature);
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
      const addr = stellarGenerateAddress(spendingPubKey, viewingPubKey, ephemeralSeed);
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
      return stellarCheckAddress(ephemeralPubKey, viewingKey, spendingPubKey, viewTag);
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

  async function fetchAnnouncementsList(
    chain?: string,
    sorobanUrl?: string,
  ): Promise<Announcement[]> {
    loading.value = true;
    error.value = null;
    try {
      const stream = fetchAnnouncementsStream(chain, sorobanUrl);
      const list = await collectAnnouncements(stream);
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
      const result = stellarScan(announcementsList, viewingKey, spendingPubKey, spendingScalar);
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
