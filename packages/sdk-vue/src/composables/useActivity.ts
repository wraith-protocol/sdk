import { ref, readonly } from 'vue';
import {
  scanAnnouncements as evmScan,
  type Announcement as EvmAnnouncement,
} from '@wraith-protocol/sdk/chains/evm';
import { scanAnnouncements as stellarScan } from '@wraith-protocol/sdk/chains/stellar';
import { scanAnnouncements as solanaScan } from '@wraith-protocol/sdk/chains/solana';
import type { AnyStealthKeys } from './useStealthKeys';

export type ActivityChain = 'evm' | 'stellar' | 'solana';

export interface ActivityEvent {
  id: string;
  chain: ActivityChain;
  type: 'incoming' | 'outgoing';
  stealthAddress: string;
  timestamp: number;
  data: unknown;
}

export interface ScanActivityInput {
  chain: ActivityChain;
  announcements: unknown[];
  keys: AnyStealthKeys;
}

export function useActivity() {
  const scanning = ref(false);
  const error = ref<string | null>(null);
  const events = ref<ActivityEvent[]>([]);
  const totalMatched = ref(0);

  async function scanAnnouncements(
    announcementsInput: ScanActivityInput[],
  ): Promise<ActivityEvent[]> {
    scanning.value = true;
    error.value = null;
    try {
      const newEvents: ActivityEvent[] = [];
      for (const input of announcementsInput) {
        const { chain, announcements: anns, keys } = input;
        if (!anns || anns.length === 0) continue;
        let matched: { stealthAddress?: string }[];
        switch (chain) {
          case 'evm': {
            const k = keys as unknown as Record<string, string>;
            matched = evmScan(
              anns as EvmAnnouncement[],
              k.viewingKey as `0x${string}`,
              k.spendingPubKey as `0x${string}`,
              k.spendingKey as `0x${string}`,
            ) as unknown as { stealthAddress?: string }[];
            break;
          }
          case 'stellar': {
            const k = keys as unknown as Record<string, unknown>;
            matched = stellarScan(
              anns as any[],
              k.viewingKey as Uint8Array,
              k.spendingPubKey as Uint8Array,
              k.spendingScalar as bigint,
            ) as unknown as { stealthAddress?: string }[];
            break;
          }
          case 'solana': {
            const k = keys as unknown as Record<string, unknown>;
            matched = solanaScan(
              anns as any[],
              k.viewingKey as Uint8Array,
              k.spendingPubKey as Uint8Array,
              k.spendingScalar as bigint,
            ) as unknown as { stealthAddress?: string }[];
            break;
          }
        }
        for (const m of matched) {
          newEvents.push({
            id: `${chain}-${newEvents.length}-${Date.now()}`,
            chain,
            type: 'incoming',
            stealthAddress: m.stealthAddress ?? 'unknown',
            timestamp: Date.now(),
            data: m,
          });
        }
      }
      events.value = [...events.value, ...newEvents];
      totalMatched.value += newEvents.length;
      return newEvents;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Activity scan failed';
      error.value = msg;
      throw e;
    } finally {
      scanning.value = false;
    }
  }

  function clear() {
    events.value = [];
    totalMatched.value = 0;
    error.value = null;
  }

  return {
    scanning: readonly(scanning),
    error: readonly(error),
    events: readonly(events),
    totalMatched: readonly(totalMatched),
    scanAnnouncements,
    clear,
  };
}
