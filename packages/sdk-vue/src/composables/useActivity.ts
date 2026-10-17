import { ref, readonly } from 'vue';
import {
  scanAnnouncements as evmScan,
  type MatchedAnnouncement as EvmMatchedAnnouncement,
} from '@wraith-protocol/sdk/chains/evm';
import {
  scanAnnouncements as stellarScan,
  type MatchedAnnouncement as StellarMatchedAnnouncement,
} from '@wraith-protocol/sdk/chains/stellar';
import {
  scanAnnouncements as solanaScan,
  type MatchedAnnouncement as SolanaMatchedAnnouncement,
} from '@wraith-protocol/sdk/chains/solana';
import { getUnknownErrorMessage } from '@wraith-protocol/sdk';
import { assertScannerScanInput, type ScannerScanInput } from './useScanner';

export type ActivityChain = 'evm' | 'stellar' | 'solana';

export type AnyMatchedAnnouncement =
  | EvmMatchedAnnouncement
  | StellarMatchedAnnouncement
  | SolanaMatchedAnnouncement;

/**
 * One chain's announcements and the key material that must match that chain.
 *
 * This is the same discriminated union {@link useScanner} scans with, so an EVM
 * announcement list can only be paired with EVM keys.
 */
export type ScanActivityInput = ScannerScanInput;

export interface ActivityEvent {
  id: string;
  chain: ActivityChain;
  type: 'incoming' | 'outgoing';
  stealthAddress: string;
  timestamp: number;
  data: AnyMatchedAnnouncement;
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
        assertScannerScanInput(input);
        if (input.announcements.length === 0) continue;

        let matched: AnyMatchedAnnouncement[];
        switch (input.chain) {
          case 'evm':
            matched = evmScan(
              input.announcements,
              input.keys.viewingKey,
              input.keys.spendingPubKey,
              input.keys.spendingKey,
            );
            break;
          case 'stellar':
            matched = stellarScan(
              input.announcements,
              input.keys.viewingKey,
              input.keys.spendingPubKey,
              input.keys.spendingScalar,
            );
            break;
          case 'solana':
            matched = solanaScan(
              input.announcements,
              input.keys.viewingKey,
              input.keys.spendingPubKey,
              input.keys.spendingScalar,
            );
            break;
        }

        for (const match of matched) {
          newEvents.push({
            id: `${input.chain}-${newEvents.length}-${Date.now()}`,
            chain: input.chain,
            type: 'incoming',
            stealthAddress: match.stealthAddress,
            timestamp: Date.now(),
            data: match,
          });
        }
      }

      events.value = [...events.value, ...newEvents];
      totalMatched.value += newEvents.length;
      return newEvents;
    } catch (cause) {
      error.value = getUnknownErrorMessage(cause);
      throw cause;
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
