import { writable, readonly, get } from 'svelte/store';
import {
  deriveStealthKeys as stellarDeriveKeys,
  generateStealthAddress as stellarGenerateAddress,
  checkStealthAddress as stellarCheckAddress,
  scanAnnouncements as stellarScan,
  deriveStealthPrivateScalar,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  fetchAnnouncementsStream,
} from '@wraith-protocol/sdk/chains/stellar';
import type {
  StealthKeys,
  GeneratedStealthAddress,
  Announcement,
  MatchedAnnouncement,
  StealthMetaAddress,
} from '@wraith-protocol/sdk/chains/stellar';

export function useStellarStealthKeys() {
  const _keys = writable<StealthKeys | null>(null);
  const _stealthAddress = writable<GeneratedStealthAddress | null>(null);
  const _announcements = writable<Announcement[]>([]);
  const _matched = writable<MatchedAnnouncement[]>([]);
  const _metaAddress = writable<string | null>(null);
  const _loading = writable(false);
  const _error = writable<string | null>(null);

  function deriveKeys(signature: Uint8Array): StealthKeys {
    _loading.set(true);
    _error.set(null);
    try {
      const k = stellarDeriveKeys(signature);
      _keys.set(k);
      return k;
    } catch (e) {
      _error.set(e instanceof Error ? e.message : 'Key derivation failed');
      throw e;
    } finally {
      _loading.set(false);
    }
  }

  // React parity: `useStellarStealthKeys` exposes this operation as `generate`.
  const generate = deriveKeys;

  function generateAddress(
    spendingPubKey: Uint8Array,
    viewingPubKey: Uint8Array,
    ephemeralSeed?: Uint8Array,
  ): GeneratedStealthAddress {
    _loading.set(true);
    _error.set(null);
    try {
      const addr = stellarGenerateAddress(spendingPubKey, viewingPubKey, ephemeralSeed);
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
    ephemeralPubKey: Uint8Array,
    viewingKey: Uint8Array,
    spendingPubKey: Uint8Array,
    viewTag: number,
  ) {
    _loading.set(true);
    _error.set(null);
    try {
      return stellarCheckAddress(ephemeralPubKey, viewingKey, spendingPubKey, viewTag);
    } catch (e) {
      _error.set(e instanceof Error ? e.message : 'Address check failed');
      throw e;
    } finally {
      _loading.set(false);
    }
  }

  function derivePrivateScalar(
    spendingScalar: bigint,
    viewingKey: Uint8Array,
    ephemeralPubKey: Uint8Array,
  ): bigint {
    _loading.set(true);
    _error.set(null);
    try {
      return deriveStealthPrivateScalar(spendingScalar, viewingKey, ephemeralPubKey);
    } catch (e) {
      _error.set(e instanceof Error ? e.message : 'Private scalar derivation failed');
      throw e;
    } finally {
      _loading.set(false);
    }
  }

  function encodeMetaAddress(spendingPubKey: Uint8Array, viewingPubKey: Uint8Array): string {
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
    chain?: string,
    sorobanUrl?: string,
  ): Promise<Announcement[]> {
    _loading.set(true);
    _error.set(null);
    try {
      const list: Announcement[] = [];
      for await (const announcement of fetchAnnouncementsStream(chain ?? 'stellar', sorobanUrl)) {
        list.push(announcement);
      }
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
    viewingKey: Uint8Array,
    spendingPubKey: Uint8Array,
    spendingScalar: bigint,
  ): MatchedAnnouncement[] {
    _loading.set(true);
    _error.set(null);
    try {
      const result = stellarScan(announcementsList, viewingKey, spendingPubKey, spendingScalar);
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
    generate,
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
