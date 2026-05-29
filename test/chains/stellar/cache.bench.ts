import { bench } from 'vitest';
import { MemoryCache } from '../../../src/chains/stellar/cache';
import type { Announcement } from '../../../src/chains/stellar/types';

function makeAnn(stealthAddress: string, ledger: number): Announcement {
  return {
    schemeId: 1,
    stealthAddress,
    caller: 'GCALLER',
    ephemeralPubKey: '00'.repeat(32),
    metadata: '01',
    ledger,
  };
}

function makeAnns(count: number, startLedger = 100): Announcement[] {
  return Array.from({ length: count }, (_, i) =>
    makeAnn(`GSTEALTH${i.toString().padStart(6, '0')}`, startLedger + i),
  );
}

const BENCH_ANNS = makeAnns(1000, 1);

bench('MemoryCache.put — 1000 announcements', async () => {
  const c = new MemoryCache();
  await c.put('testnet', BENCH_ANNS);
});

bench('MemoryCache.get — 1000 announcements full range', async () => {
  const c = new MemoryCache();
  await c.put('testnet', BENCH_ANNS);
  await c.get('testnet', 1, 1000);
});

bench('MemoryCache.put+get — incremental delta (10 anns)', async () => {
  const c = new MemoryCache();
  await c.put('testnet', BENCH_ANNS);
  const delta = makeAnns(10, 1001);
  await c.put('testnet', delta);
  await c.get('testnet', 1, 1010);
});
