#!/usr/bin/env node
import { scanAll } from '@wraith-protocol/sdk';
import type { ChainScannerAdapter, CustomChainInput } from '@wraith-protocol/sdk';

interface CustomAnnouncement {
  txId: string;
  recipientKey: string;
  amount: string;
}

interface CustomMatchedAnnouncement {
  txId: string;
  amount: string;
  stealthPrivateKey: string;
}

interface CustomKeys {
  viewingKey: string;
  spendingKey: string;
}

/**
 * Example third-party chain scanner adapter for a custom blockchain ("foo-chain").
 */
const fooChainAdapter: ChainScannerAdapter<
  CustomAnnouncement,
  CustomKeys,
  CustomMatchedAnnouncement,
  { spendingPubKey: string; viewingPubKey: string }
> = {
  id: 'foo-chain',

  scan: async function* (source, keys) {
    for await (const ann of source) {
      if (ann.recipientKey === keys.viewingKey) {
        yield {
          txId: ann.txId,
          amount: ann.amount,
          stealthPrivateKey: `derived-privkey-for-${ann.txId}`,
        };
      }
    }
  },

  decodeMetaAddress(metaAddress: string) {
    const parts = metaAddress.replace(/^st:foo:/, '').split(':');
    return {
      spendingPubKey: parts[0] || '',
      viewingPubKey: parts[1] || '',
    };
  },

  encodeMetaAddress(spendingPubKey: string, viewingPubKey: string) {
    return `st:foo:${spendingPubKey}:${viewingPubKey}`;
  },
};

async function* mockSource(): AsyncGenerator<CustomAnnouncement> {
  yield { txId: '0x123', recipientKey: 'view-key-42', amount: '100 FOO' };
  yield { txId: '0x456', recipientKey: 'view-key-99', amount: '50 FOO' };
  yield { txId: '0x789', recipientKey: 'view-key-42', amount: '250 FOO' };
}

async function main() {
  console.log('=== Custom Chain Adapter Example ===\n');

  const customChain: CustomChainInput<CustomAnnouncement, CustomKeys, CustomMatchedAnnouncement> = {
    adapter: fooChainAdapter,
    source: mockSource(),
    keys: {
      viewingKey: 'view-key-42',
      spendingKey: 'spend-key-42',
    },
  };

  console.log(`Scanning custom chain "${fooChainAdapter.id}" via scanAll()...\n`);

  let count = 0;
  for await (const match of scanAll({ adapters: [customChain] })) {
    count++;
    console.log(`Match #${count} [${match.chain}] seq=${match.seq}:`);
    console.log(`  Tx ID: ${match.announcement.txId}`);
    console.log(`  Amount: ${match.announcement.amount}`);
    console.log(`  Derived Private Key: ${match.announcement.stealthPrivateKey}\n`);
  }

  console.log(`=== Done — found ${count} match(es) ===`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
