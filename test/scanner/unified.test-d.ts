import { describe, test, expectTypeOf } from 'vitest';
import type {
  ChainScannerAdapter,
  CustomChainInput,
  ScanAllInput,
  MatchedAnnouncement,
} from '../../src/scanner/unified';

interface FooAnnouncement {
  txId: string;
  recipientKey: string;
}

interface FooKeys {
  viewingKey: string;
}

interface FooMatched {
  matchedTxId: string;
}

describe('ChainScannerAdapter / CustomChainInput type safety', () => {
  test('a fully-typed adapter narrows scan(), decodeMetaAddress(), and timestampOf() correctly', () => {
    const fooAdapter: ChainScannerAdapter<FooAnnouncement, FooKeys, FooMatched, string> = {
      id: 'foo',
      scan: async function* (source, keys) {
        expectTypeOf(source).toEqualTypeOf<AsyncIterable<FooAnnouncement>>();
        expectTypeOf(keys).toEqualTypeOf<FooKeys>();
        yield { matchedTxId: 'abc' };
      },
      decodeMetaAddress: (metaAddress) => {
        expectTypeOf(metaAddress).toBeString();
        return 'decoded';
      },
      encodeMetaAddress: (spendingPubKey, viewingPubKey) => {
        // The public API intentionally types these as `unknown` — every chain
        // encodes different key material, so a real adapter must narrow itself.
        expectTypeOf(spendingPubKey).toBeUnknown();
        expectTypeOf(viewingPubKey).toBeUnknown();
        return 'st:foo:...';
      },
      timestampOf: (matched) => {
        expectTypeOf(matched).toEqualTypeOf<FooMatched>();
        return 0;
      },
    };

    expectTypeOf(fooAdapter.id).toBeString();
  });

  test('CustomChainInput requires adapter/source/keys to agree on generic parameters', () => {
    const fooAdapter: ChainScannerAdapter<FooAnnouncement, FooKeys, FooMatched> = {
      id: 'foo',
      scan: async function* () {},
      decodeMetaAddress: () => ({}),
      encodeMetaAddress: () => '',
    };

    const validInput: CustomChainInput<FooAnnouncement, FooKeys, FooMatched> = {
      adapter: fooAdapter,
      source: (async function* () {})(),
      keys: { viewingKey: 'vk' },
    };
    expectTypeOf(validInput).toMatchTypeOf<
      CustomChainInput<FooAnnouncement, FooKeys, FooMatched>
    >();

    // @ts-expect-error keys must match the adapter's TKeys — a string is not FooKeys
    const mismatchedKeys: CustomChainInput<FooAnnouncement, FooKeys, FooMatched> = {
      adapter: fooAdapter,
      source: (async function* () {})(),
      keys: 'not-foo-keys',
    };
  });

  test('ScanAllInput.adapters accepts a heterogeneous array of CustomChainInput without any', () => {
    const fooAdapter: ChainScannerAdapter<FooAnnouncement, FooKeys, FooMatched> = {
      id: 'foo',
      scan: async function* () {},
      decodeMetaAddress: () => ({}),
      encodeMetaAddress: () => '',
    };
    const fooInput: CustomChainInput<FooAnnouncement, FooKeys, FooMatched> = {
      adapter: fooAdapter,
      source: (async function* () {})(),
      keys: { viewingKey: 'vk' },
    };

    interface BarKeys {
      spendKey: string;
    }
    const barAdapter: ChainScannerAdapter<string, BarKeys, number> = {
      id: 'bar',
      scan: async function* () {},
      decodeMetaAddress: () => ({}),
      encodeMetaAddress: () => '',
    };
    const barInput: CustomChainInput<string, BarKeys, number> = {
      adapter: barAdapter,
      source: (async function* () {})(),
      keys: { spendKey: 'sk' },
    };

    // Two structurally different CustomChainInput instantiations coexist in one
    // array — this is exactly what previously required `| any` to express.
    const input: ScanAllInput = {
      adapters: [fooInput, barInput],
    };
    expectTypeOf(input.adapters).not.toBeAny();
  });

  test('MatchedAnnouncement discriminates on chain, including the custom-adapter arm', () => {
    function handle(matched: MatchedAnnouncement) {
      if (matched.chain === 'evm') {
        expectTypeOf(matched.announcement).not.toBeAny();
        expectTypeOf(matched.announcement).not.toBeUnknown();
      } else if (
        matched.chain !== 'stellar' &&
        matched.chain !== 'solana' &&
        matched.chain !== 'ckb'
      ) {
        // Custom-adapter arm: chain is a bare string, announcement is unknown
        // (not `any`) — callers must narrow before use.
        expectTypeOf(matched.chain).toBeString();
        expectTypeOf(matched.announcement).toBeUnknown();
      }
    }
    expectTypeOf(handle).toBeFunction();
  });
});
