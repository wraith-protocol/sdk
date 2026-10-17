import { expectTypeOf, test } from 'vitest';
import type {
  Announcement as EvmAnnouncement,
  MatchedAnnouncement as EvmMatchedAnnouncement,
  StealthKeys as EvmStealthKeys,
} from '@wraith-protocol/sdk/chains/evm';
import type {
  Announcement as StellarAnnouncement,
  MatchedAnnouncement as StellarMatchedAnnouncement,
  StealthKeys as StellarStealthKeys,
} from '@wraith-protocol/sdk/chains/stellar';
import { useScanner } from '../src/composables/useScanner';

const evmAnnouncements = null as unknown as EvmAnnouncement[];
const stellarAnnouncements = null as unknown as StellarAnnouncement[];
const evmKeys = null as unknown as EvmStealthKeys;
const stellarKeys = null as unknown as StellarStealthKeys;

test('a matching chain and key material produces the chain-specific matches', () => {
  const scanner = useScanner('evm');

  expectTypeOf(
    scanner.scanAnnouncements({
      chain: 'evm',
      announcements: evmAnnouncements,
      keys: evmKeys,
    }),
  ).toEqualTypeOf<EvmMatchedAnnouncement[]>();

  expectTypeOf(
    scanner.scanAnnouncements({
      chain: 'stellar',
      announcements: stellarAnnouncements,
      keys: stellarKeys,
    }),
  ).toEqualTypeOf<StellarMatchedAnnouncement[]>();
});

test('mismatched key material is rejected at compile time', () => {
  const scanner = useScanner();

  // @ts-expect-error - Stellar key material cannot scan an EVM announcement list
  scanner.scanAnnouncements({ chain: 'evm', announcements: evmAnnouncements, keys: stellarKeys });

  // @ts-expect-error - EVM key material cannot scan a Stellar announcement list
  scanner.scanAnnouncements({
    chain: 'stellar',
    announcements: stellarAnnouncements,
    keys: evmKeys,
  });

  // @ts-expect-error - EVM keys cannot scan an EVM-typed list under the Stellar discriminant
  scanner.scanAnnouncements({
    chain: 'stellar',
    announcements: evmAnnouncements,
    keys: evmKeys,
  });
});

test('scanWithKeys requires the key material to match the chain', () => {
  const scanner = useScanner();

  expectTypeOf(scanner.scanWithKeys({ chain: 'evm', keys: evmKeys })).toEqualTypeOf<
    Promise<EvmMatchedAnnouncement[]>
  >();

  // @ts-expect-error - Stellar keys are not valid EVM scanner keys
  void scanner.scanWithKeys({ chain: 'evm', keys: stellarKeys });

  // @ts-expect-error - EVM keys are not valid Stellar scanner keys
  void scanner.scanWithKeys({ chain: 'stellar', keys: evmKeys });
});

test('fetch options are a chain-discriminated union with one cancellation shape', () => {
  const scanner = useScanner();

  void scanner.fetchAnnouncements({ chain: 'stellar', network: 'stellar' });
  void scanner.fetchAnnouncements({ chain: 'evm', signal: new AbortController().signal });

  // @ts-expect-error - "bitcoin" is not a supported scanner chain
  void scanner.fetchAnnouncements({ chain: 'bitcoin' });

  // @ts-expect-error - signal must be an AbortSignal
  void scanner.fetchAnnouncements({ chain: 'stellar', signal: 'stop' });

  // @ts-expect-error - EVM fetches have no Stellar ledger options
  void scanner.fetchAnnouncements({ chain: 'evm', fromLedger: 10 });
});
