import { writable, readonly } from 'svelte/store';
import {
  deriveStealthKeys as evmDeriveKeys,
  generateStealthAddress as evmGenerateAddress,
  checkStealthAddress as evmCheckAddress,
  scanAnnouncements as evmScan,
  deriveStealthPrivateKey,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  fetchAnnouncements,
} from '@wraith-protocol/sdk/chains/evm';
import type {
  HexString,
  StealthKeys,
  GeneratedStealthAddress,
  Announcement,
  MatchedAnnouncement,
  StealthMetaAddress,
} from '@wraith-protocol/sdk/chains/evm';

export function useEvmStealthKeys() {
  const _keys = writable<StealthKeys | null>(null);
  const _stealthAddress = writable<GeneratedStealthAddress | null>(null);
  const _announcements = writable<Announcement[]>([]);
  const _matched = writable<MatchedAnnouncement[]>([]);
  const _metaAddress = writable<string | null>(null);
  const _loading = writable(false);
  const _error = writable<string | null>(null);

  function deriveKeys(signature: HexString): StealthKeys {
    _loading.set(true);
    _error.set(null);
    try {
      const k = evmDeriveKeys(signature);
      _keys.set(k);
      return k;
    } catch (e) {
      _error.set(e instanceof Error ? e.message : 'Key derivation failed');
      throw e;
    } finally {
      _loading.set(false);
    }
  }

  function generateAddress(
    spendingPubKey: HexString,
    viewingPubKey: HexString,
    ephemeralPrivateKey?: HexString,
  ): GeneratedStealthAddress {
    _loading.set(true);
    _error.set(null);
    try {
      const addr = evmGenerateAddress(spendingPubKey, viewingPubKey, ephemeralPrivateKey);
      _stealthAddress.set(addr);
      return addr;
    } catch (e) {
      _error.set(e instanceof Error ? e.message : 'Address generation failed');
      throw e;
    } finally {
      _loading.set(false);
    }
  }

  function checkAddress(
    ephemeralPubKey: HexString,
    viewingKey: HexString,
    spendingPubKey: HexString,
    viewTag: number,
  ) {
    _loading.set(true);
    _error.set(null);
    try {
      return evmCheckAddress(ephemeralPubKey, viewingKey, spendingPubKey, viewTag);
    } catch (e) {
      _error.set(e instanceof Error ? e.message : 'Address check failed');
      throw e;
    } finally {
      _loading.set(false);
    }
  }

  function derivePrivateKey(
    spendingKey: HexString,
    ephemeralPubKey: HexString,
    viewingKey: HexString,
  ): HexString {
    _loading.set(true);
    _error.set(null);
    try {
      return deriveStealthPrivateKey(spendingKey, ephemeralPubKey, viewingKey);
    } catch (e) {
      _error.set(e instanceof Error ? e.message : 'Private key derivation failed');
      throw e;
    } finally {
      _loading.set(false);
    }
  }

  function encodeMetaAddress(spendingPubKey: HexString, viewingPubKey: HexString): string {
    try {
      const encoded = encodeStealthMetaAddress(spendingPubKey, viewingPubKey);
      _metaAddress.set(encoded);
      return encoded;
    } catch (e) {
      _error.set(e instanceof Error ? e.message : 'Meta address encoding failed');
      throw e;
    }
  }

  function decodeMetaAddress(address: string): StealthMetaAddress {
    _loading.set(true);
    _error.set(null);
    try {
      return decodeStealthMetaAddress(address);
    } catch (e) {
      _error.set(e instanceof Error ? e.message : 'Meta address decoding failed');
      throw e;
    } finally {
      _loading.set(false);
    }
  }

  async function fetchAnnouncementsList(
    chain: string,
    subgraphUrl?: string,
  ): Promise<Announcement[]> {
    _loading.set(true);
    _error.set(null);
    try {
      const list = await fetchAnnouncements(chain, subgraphUrl);
      _announcements.set(list);
      return list;
    } catch (e) {
      _error.set(e instanceof Error ? e.message : 'Failed to fetch announcements');
      throw e;
    } finally {
      _loading.set(false);
    }
  }

  function scanAnnouncements(
    announcementsList: Announcement[],
    viewingKey: HexString,
    spendingPubKey: HexString,
    spendingKey: HexString,
  ): MatchedAnnouncement[] {
    _loading.set(true);
    _error.set(null);
    try {
      const result = evmScan(announcementsList, viewingKey, spendingPubKey, spendingKey);
      _matched.set(result);
      return result;
    } catch (e) {
      _error.set(e instanceof Error ? e.message : 'Scan failed');
      throw e;
    } finally {
      _loading.set(false);
    }
  }

  return {
    keys: readonly(_keys),
    stealthAddress: readonly(_stealthAddress),
    announcements: readonly(_announcements),
    matched: readonly(_matched),
    metaAddress: readonly(_metaAddress),
    loading: readonly(_loading),
    error: readonly(_error),
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
