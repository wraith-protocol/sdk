import { createSignal } from 'solid-js';
import {
  deriveStealthKeys as stellarDeriveKeys,
  generateStealthAddress as stellarGenerateAddress,
  checkStealthAddress as stellarCheckAddress,
  scanAnnouncements as stellarScan,
  deriveStealthPrivateScalar,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  fetchAnnouncementsStream,
  type FetchAnnouncementsOptions,
} from '@wraith-protocol/sdk/chains/stellar';
import type {
  StealthKeys,
  GeneratedStealthAddress,
  Announcement,
  MatchedAnnouncement,
  StealthMetaAddress,
} from '@wraith-protocol/sdk/chains/stellar';

/**
 * Solid primitive for managing Stellar stealth keys.
 *
 * Uses fine-grained signals for reactive state. All reactive values are
 * returned as getter functions following Solid conventions.
 */
export function createStealthKeys() {
  const [keys, setKeys] = createSignal<StealthKeys | null>(null);
  const [stealthAddress, setStealthAddress] = createSignal<GeneratedStealthAddress | null>(null);
  const [announcements, setAnnouncements] = createSignal<Announcement[]>([]);
  const [matched, setMatched] = createSignal<MatchedAnnouncement[]>([]);
  const [metaAddress, setMetaAddress] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  function deriveKeys(signature: Uint8Array): StealthKeys {
    setLoading(true);
    setError(null);
    try {
      const k = stellarDeriveKeys(signature);
      setKeys(() => k);
      return k;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Key derivation failed');
      throw e;
    } finally {
      setLoading(false);
    }
  }

  function generateAddress(
    spendingPubKey: Uint8Array,
    viewingPubKey: Uint8Array,
    ephemeralSeed?: Uint8Array,
  ): GeneratedStealthAddress {
    setLoading(true);
    setError(null);
    try {
      const addr = stellarGenerateAddress(spendingPubKey, viewingPubKey, ephemeralSeed);
      setStealthAddress(() => addr);
      return addr;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Address generation failed');
      throw e;
    } finally {
      setLoading(false);
    }
  }

  function checkAddress(
    ephemeralPubKey: Uint8Array,
    viewingKey: Uint8Array,
    spendingPubKey: Uint8Array,
    viewTag: number,
  ) {
    setLoading(true);
    setError(null);
    try {
      return stellarCheckAddress(ephemeralPubKey, viewingKey, spendingPubKey, viewTag);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Address check failed');
      throw e;
    } finally {
      setLoading(false);
    }
  }

  function derivePrivateScalar(
    spendingScalar: bigint,
    viewingKey: Uint8Array,
    ephemeralPubKey: Uint8Array,
  ): bigint {
    setLoading(true);
    setError(null);
    try {
      return deriveStealthPrivateScalar(spendingScalar, viewingKey, ephemeralPubKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Private scalar derivation failed');
      throw e;
    } finally {
      setLoading(false);
    }
  }

  function encodeMetaAddress(spendingPubKey: Uint8Array, viewingPubKey: Uint8Array): string {
    setError(null);
    try {
      const encoded = encodeStealthMetaAddress(spendingPubKey, viewingPubKey);
      setMetaAddress(encoded);
      return encoded;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Meta address encoding failed');
      throw e;
    }
  }

  function decodeMetaAddress(address: string): StealthMetaAddress {
    setLoading(true);
    setError(null);
    try {
      return decodeStealthMetaAddress(address);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Meta address decoding failed');
      throw e;
    } finally {
      setLoading(false);
    }
  }

  /**
   * Fetch announcements from the Stellar network (collects the streaming pages).
   */
  async function fetchAnnouncements(
    chain = 'stellar',
    opts?: FetchAnnouncementsOptions,
  ): Promise<Announcement[]> {
    setLoading(true);
    setError(null);
    try {
      const collected: Announcement[] = [];
      for await (const announcement of fetchAnnouncementsStream(chain, opts)) {
        collected.push(announcement);
      }
      setAnnouncements(collected);
      return collected;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch announcements');
      throw e;
    } finally {
      setLoading(false);
    }
  }

  function scanAnnouncements(
    announcementsList: Announcement[],
    viewingKey: Uint8Array,
    spendingPubKey: Uint8Array,
    spendingScalar: bigint,
  ): MatchedAnnouncement[] {
    setLoading(true);
    setError(null);
    try {
      const result = stellarScan(announcementsList, viewingKey, spendingPubKey, spendingScalar);
      setMatched(() => result);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed');
      throw e;
    } finally {
      setLoading(false);
    }
  }

  return {
    // Reactive getters (Solid signal accessors)
    keys,
    stealthAddress,
    announcements,
    matched,
    metaAddress,
    loading,
    error,
    // Actions
    deriveKeys,
    generateAddress,
    checkAddress,
    derivePrivateScalar,
    encodeMetaAddress,
    decodeMetaAddress,
    fetchAnnouncements,
    scanAnnouncements,
  };
}
