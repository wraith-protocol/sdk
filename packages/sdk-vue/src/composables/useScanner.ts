import { ref, readonly } from 'vue';
import {
  fetchAnnouncements as evmFetchAnnouncements,
  scanAnnouncements as evmScanAnnouncements,
  checkStealthAddress as evmCheckAddress,
  type HexString,
  type Announcement as EvmAnnouncement,
  type MatchedAnnouncement as EvmMatchedAnnouncement,
} from '@wraith-protocol/sdk/chains/evm';
import {
  fetchAnnouncementsStream as stellarFetchAnnouncementsStream,
  scanAnnouncements as stellarScanAnnouncements,
  checkStealthAddress as stellarCheckAddress,
  type Announcement as StellarAnnouncement,
  type MatchedAnnouncement as StellarMatchedAnnouncement,
} from '@wraith-protocol/sdk/chains/stellar';
import {
  fetchAnnouncements as solanaFetchAnnouncements,
  scanAnnouncements as solanaScanAnnouncements,
  checkStealthAddress as solanaCheckAddress,
  type Announcement as SolanaAnnouncement,
  type MatchedAnnouncement as SolanaMatchedAnnouncement,
} from '@wraith-protocol/sdk/chains/solana';
import type { StealthChain, AnyStealthKeys } from './useStealthKeys';

async function collectStream<T>(stream: AsyncGenerator<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of stream) result.push(item);
  return result;
}

export type AnyAnnouncement = EvmAnnouncement | StellarAnnouncement | SolanaAnnouncement;
export type AnyMatchedAnnouncement =
  | EvmMatchedAnnouncement
  | StellarMatchedAnnouncement
  | SolanaMatchedAnnouncement;

export function useScanner(chain?: StealthChain) {
  const activeChain = ref<StealthChain>(chain ?? 'stellar');
  const announcements = ref<AnyAnnouncement[]>([]);
  const matched = ref<AnyMatchedAnnouncement[]>([]);
  const scanning = ref(false);
  const error = ref<string | null>(null);

  function setChain(c: StealthChain) {
    activeChain.value = c;
  }

  async function fetchAnnouncementsList(
    chainOrOpts?: string | { chain: string; url?: string },
    url?: string,
  ): Promise<AnyAnnouncement[]> {
    scanning.value = true;
    error.value = null;
    try {
      let list: AnyAnnouncement[];
      switch (activeChain.value) {
        case 'evm': {
          const c = typeof chainOrOpts === 'string' ? chainOrOpts : (chainOrOpts as any)?.chain;
          const u = typeof chainOrOpts === 'object' ? (chainOrOpts as any).url : url;
          list = await evmFetchAnnouncements(c ?? activeChain.value, u);
          break;
        }
        case 'stellar': {
          const c = typeof chainOrOpts === 'string' ? chainOrOpts : undefined;
          const u = typeof chainOrOpts === 'object' ? (chainOrOpts as any).url : url;
          const stream = stellarFetchAnnouncementsStream(c, u);
          list = await collectStream(stream);
          break;
        }
        case 'solana': {
          const c = typeof chainOrOpts === 'string' ? chainOrOpts : undefined;
          const u = typeof chainOrOpts === 'object' ? (chainOrOpts as any).url : url;
          list = await solanaFetchAnnouncements(c, u);
          break;
        }
      }
      announcements.value = list;
      return list;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to fetch announcements';
      error.value = msg;
      throw e;
    } finally {
      scanning.value = false;
    }
  }

  function scanAnnouncements(
    announcementsList: AnyAnnouncement[],
    viewingKey: Uint8Array | HexString,
    spendingPubKey: Uint8Array | HexString,
    spendingKey: Uint8Array | HexString | bigint,
  ): AnyMatchedAnnouncement[] {
    scanning.value = true;
    error.value = null;
    try {
      let result: AnyMatchedAnnouncement[];
      switch (activeChain.value) {
        case 'evm':
          result = evmScanAnnouncements(
            announcementsList as EvmAnnouncement[],
            viewingKey as HexString,
            spendingPubKey as HexString,
            spendingKey as HexString,
          );
          break;
        case 'stellar':
          result = stellarScanAnnouncements(
            announcementsList as StellarAnnouncement[],
            viewingKey as Uint8Array,
            spendingPubKey as Uint8Array,
            spendingKey as bigint,
          );
          break;
        case 'solana':
          result = solanaScanAnnouncements(
            announcementsList as SolanaAnnouncement[],
            viewingKey as Uint8Array,
            spendingPubKey as Uint8Array,
            spendingKey as bigint,
          );
          break;
      }
      matched.value = result;
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Scan failed';
      error.value = msg;
      throw e;
    } finally {
      scanning.value = false;
    }
  }

  function checkAddress(
    ephemeralPubKey: Uint8Array | HexString,
    viewingKey: Uint8Array | HexString,
    spendingPubKey: Uint8Array | HexString,
    viewTag: number,
  ) {
    scanning.value = true;
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
      scanning.value = false;
    }
  }

  async function scanWithKeys(
    keys: AnyStealthKeys,
    chainOrUrl?: string,
  ): Promise<AnyMatchedAnnouncement[]> {
    await fetchAnnouncementsList(chainOrUrl);
    if (announcements.value.length === 0) return [];
    let spendKey: any;
    switch (activeChain.value) {
      case 'evm':
        spendKey = (keys as any).spendingKey;
        break;
      case 'stellar':
      case 'solana':
        spendKey = (keys as any).spendingScalar;
        break;
    }
    return scanAnnouncements(
      announcements.value,
      (keys as any).viewingKey,
      (keys as any).spendingPubKey,
      spendKey,
    );
  }

  function clear() {
    announcements.value = [];
    matched.value = [];
    error.value = null;
  }

  return {
    announcements: readonly(announcements),
    matched: readonly(matched),
    scanning: readonly(scanning),
    error: readonly(error),
    chain: readonly(activeChain),
    setChain,
    fetchAnnouncements: fetchAnnouncementsList,
    scanAnnouncements,
    checkAddress,
    scanWithKeys,
    clear,
  };
}
