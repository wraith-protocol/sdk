import { describe, test, expect } from 'vitest';
import { scanAll } from '../../src/scanner/unified';
import type {
  ScanAllInput,
  MatchedAnnouncement,
  EvmChainInput,
  StellarChainInput,
} from '../../src/scanner/unified';
import { deriveStealthKeys as deriveEvmKeys } from '../../src/chains/evm/keys';
import { generateStealthAddress as generateEvmAddress } from '../../src/chains/evm/stealth';
import { SCHEME_ID as EVM_SCHEME_ID } from '../../src/chains/evm/constants';
import type {
  Announcement as EvmAnnouncement,
  HexString as EvmHexString,
} from '../../src/chains/evm/types';
import { deriveStealthKeys as deriveStellarKeys } from '../../src/chains/stellar/keys';
import { generateStealthAddress as generateStellarAddress } from '../../src/chains/stellar/stealth';
import { SCHEME_ID as STELLAR_SCHEME_ID } from '../../src/chains/stellar/constants';
import { bytesToHex as stellarBytesToHex } from '../../src/chains/stellar/utils';
import type { Announcement as StellarAnnouncement } from '../../src/chains/stellar/types';

const evmSig = ('0x' + 'aa'.repeat(32) + 'bb'.repeat(32) + '1b') as EvmHexString;
const stellarSig = new Uint8Array(64).fill(0xaa);

const evmKeys = deriveEvmKeys(evmSig);
const evmStealth = generateEvmAddress(evmKeys.spendingPubKey, evmKeys.viewingPubKey);

const evmAnnouncement: EvmAnnouncement = {
  schemeId: EVM_SCHEME_ID,
  stealthAddress: evmStealth.stealthAddress,
  caller: ('0x' + 'aa'.repeat(20)) as EvmHexString,
  ephemeralPubKey: evmStealth.ephemeralPubKey,
  metadata: ('0x' + evmStealth.viewTag.toString(16).padStart(2, '0')) as EvmHexString,
};

const stellarKeys = deriveStellarKeys(stellarSig);
const stellarStealth = generateStellarAddress(
  stellarKeys.spendingPubKey,
  stellarKeys.viewingPubKey,
  new Uint8Array(32).fill(0x42),
);

const stellarAnnouncement: StellarAnnouncement = {
  schemeId: STELLAR_SCHEME_ID,
  stealthAddress: stellarStealth.stealthAddress,
  caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  ephemeralPubKey: stellarBytesToHex(stellarStealth.ephemeralPubKey),
  metadata: stellarStealth.viewTag.toString(16).padStart(2, '0'),
};

async function* toAsyncGen<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

async function collect(iter: AsyncIterable<MatchedAnnouncement>): Promise<MatchedAnnouncement[]> {
  const results: MatchedAnnouncement[] = [];
  for await (const item of iter) results.push(item);
  return results;
}

describe('scanAll', () => {
  test('single chain (evm) — finds matching announcements', async () => {
    const input: ScanAllInput = {
      evm: {
        source: toAsyncGen([evmAnnouncement, { ...evmAnnouncement, schemeId: 99n }]),
        viewingKey: evmKeys.viewingKey,
        spendingPubKey: evmKeys.spendingPubKey,
        spendingKey: evmKeys.spendingKey,
      },
    };

    const results = await collect(scanAll(input));

    expect(results).toHaveLength(1);
    expect(results[0].chain).toBe('evm');
    if (results[0].chain === 'evm') {
      expect(results[0].announcement.stealthAddress.toLowerCase()).toBe(
        evmStealth.stealthAddress.toLowerCase(),
      );
      expect(results[0].announcement.stealthPrivateKey).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  test('single chain (stellar) — finds matching announcements', async () => {
    const input: ScanAllInput = {
      stellar: {
        source: toAsyncGen([stellarAnnouncement, { ...stellarAnnouncement, schemeId: 99 }]),
        viewingKey: stellarKeys.viewingKey,
        spendingPubKey: stellarKeys.spendingPubKey,
        spendingScalar: stellarKeys.spendingScalar,
      },
    };

    const results = await collect(scanAll(input));

    expect(results).toHaveLength(1);
    expect(results[0].chain).toBe('stellar');
    if (results[0].chain === 'stellar') {
      expect(results[0].announcement.stealthAddress).toBe(stellarStealth.stealthAddress);
      expect(typeof results[0].announcement.stealthPrivateScalar).toBe('bigint');
      expect(results[0].announcement.stealthPubKeyBytes).toBeInstanceOf(Uint8Array);
    }
  });

  test('empty input — no results', async () => {
    const results = await collect(scanAll({}));
    expect(results).toHaveLength(0);
  });

  test('two chains (evm + stellar) — finds matches from both', async () => {
    const input: ScanAllInput = {
      evm: {
        source: toAsyncGen([evmAnnouncement]),
        viewingKey: evmKeys.viewingKey,
        spendingPubKey: evmKeys.spendingPubKey,
        spendingKey: evmKeys.spendingKey,
      },
      stellar: {
        source: toAsyncGen([stellarAnnouncement]),
        viewingKey: stellarKeys.viewingKey,
        spendingPubKey: stellarKeys.spendingPubKey,
        spendingScalar: stellarKeys.spendingScalar,
      },
    };

    const results = await collect(scanAll(input));

    expect(results).toHaveLength(2);
    const chains = results.map((r) => r.chain).sort();
    expect(chains).toEqual(['evm', 'stellar']);
  });

  test('no matches — empty result', async () => {
    const wrongSig = ('0x' + '11'.repeat(32) + '22'.repeat(32) + '1c') as EvmHexString;
    const wrongKeys = deriveEvmKeys(wrongSig);
    const wrongStealth = generateEvmAddress(wrongKeys.spendingPubKey, wrongKeys.viewingPubKey);

    const input: ScanAllInput = {
      evm: {
        source: toAsyncGen([
          {
            schemeId: EVM_SCHEME_ID,
            stealthAddress: wrongStealth.stealthAddress,
            caller: ('0x' + 'aa'.repeat(20)) as EvmHexString,
            ephemeralPubKey: wrongStealth.ephemeralPubKey,
            metadata: ('0x' + wrongStealth.viewTag.toString(16).padStart(2, '0')) as EvmHexString,
          },
        ]),
        viewingKey: evmKeys.viewingKey,
        spendingPubKey: evmKeys.spendingPubKey,
        spendingKey: evmKeys.spendingKey,
      },
    };

    const results = await collect(scanAll(input));
    expect(results).toHaveLength(0);
  });

  test('mixed matches and non-matches', async () => {
    const wrongSig = ('0x' + '11'.repeat(32) + '22'.repeat(32) + '1c') as EvmHexString;
    const wrongKeys = deriveEvmKeys(wrongSig);
    const wrongStealth = generateEvmAddress(wrongKeys.spendingPubKey, wrongKeys.viewingPubKey);

    const input: ScanAllInput = {
      evm: {
        source: toAsyncGen([
          evmAnnouncement,
          {
            schemeId: EVM_SCHEME_ID,
            stealthAddress: wrongStealth.stealthAddress,
            caller: ('0x' + 'aa'.repeat(20)) as EvmHexString,
            ephemeralPubKey: wrongStealth.ephemeralPubKey,
            metadata: ('0x' + wrongStealth.viewTag.toString(16).padStart(2, '0')) as EvmHexString,
          },
        ]),
        viewingKey: evmKeys.viewingKey,
        spendingPubKey: evmKeys.spendingPubKey,
        spendingKey: evmKeys.spendingKey,
      },
    };

    const results = await collect(scanAll(input));

    expect(results).toHaveLength(1);
    expect(results[0].chain).toBe('evm');
  });
});

describe('backpressure', () => {
  test('slow chain does not stall fast chain output', async () => {
    const slowSource: AsyncGenerator<EvmAnnouncement> = (async function* () {
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 100));
        yield evmAnnouncement;
      }
    })();

    const fastSource: AsyncGenerator<EvmAnnouncement> = (async function* () {
      for (let i = 0; i < 3; i++) {
        yield evmAnnouncement;
      }
    })();

    const input: ScanAllInput = {
      evm: {
        source: fastSource,
        viewingKey: evmKeys.viewingKey,
        spendingPubKey: evmKeys.spendingPubKey,
        spendingKey: evmKeys.spendingKey,
      },
      stellar: {
        source: (async function* () {
          await new Promise((r) => setTimeout(r, 500));
          yield stellarAnnouncement;
        })(),
        viewingKey: stellarKeys.viewingKey,
        spendingPubKey: stellarKeys.spendingPubKey,
        spendingScalar: stellarKeys.spendingScalar,
      },
    };

    const t0 = performance.now();
    const results: MatchedAnnouncement[] = [];
    for await (const item of scanAll(input)) {
      results.push(item);
      if (results.length === 3) {
        const elapsed = performance.now() - t0;
        expect(elapsed).toBeLessThan(500);
      }
    }
    expect(results).toHaveLength(4);
    const evmCount = results.filter((r) => r.chain === 'evm').length;
    const stellarCount = results.filter((r) => r.chain === 'stellar').length;
    expect(evmCount).toBe(3);
    expect(stellarCount).toBe(1);
  }, 10_000);

  test('fast chain results arrive before slow chain completes — ordering evidence', async () => {
    const order: string[] = [];

    const fastSource: AsyncGenerator<EvmAnnouncement> = (async function* () {
      order.push('fast-start');
      yield evmAnnouncement;
      order.push('fast-done');
    })();

    const slowSource: AsyncGenerator<StellarAnnouncement> = (async function* () {
      order.push('slow-start');
      await new Promise((r) => setTimeout(r, 200));
      yield stellarAnnouncement;
      order.push('slow-done');
    })();

    const input: ScanAllInput = {
      evm: {
        source: fastSource,
        viewingKey: evmKeys.viewingKey,
        spendingPubKey: evmKeys.spendingPubKey,
        spendingKey: evmKeys.spendingKey,
      },
      stellar: {
        source: slowSource,
        viewingKey: stellarKeys.viewingKey,
        spendingPubKey: stellarKeys.spendingPubKey,
        spendingScalar: stellarKeys.spendingScalar,
      },
    };

    const results = await collect(scanAll(input));
    expect(results).toHaveLength(2);
    expect(results[0].chain).toBe('evm');
    expect(results[1].chain).toBe('stellar');
  }, 10_000);
});

describe('cleanup', () => {
  test('iterator close performs per-chain cleanup', async () => {
    let evmCleaned = false;
    let stellarCleaned = false;

    const evmSource: AsyncGenerator<EvmAnnouncement> = (async function* () {
      try {
        while (true) {
          yield evmAnnouncement;
          await new Promise((r) => setTimeout(r, 10));
        }
      } finally {
        evmCleaned = true;
      }
    })();

    const stellarSource: AsyncGenerator<StellarAnnouncement> = (async function* () {
      try {
        while (true) {
          yield stellarAnnouncement;
          await new Promise((r) => setTimeout(r, 10));
        }
      } finally {
        stellarCleaned = true;
      }
    })();

    const input: ScanAllInput = {
      evm: {
        source: evmSource,
        viewingKey: evmKeys.viewingKey,
        spendingPubKey: evmKeys.spendingPubKey,
        spendingKey: evmKeys.spendingKey,
      },
      stellar: {
        source: stellarSource,
        viewingKey: stellarKeys.viewingKey,
        spendingPubKey: stellarKeys.spendingPubKey,
        spendingScalar: stellarKeys.spendingScalar,
      },
    };

    const iter = scanAll(input)[Symbol.asyncIterator]();
    const first = await iter.next();
    expect(first.done).toBe(false);
    expect(first.value).not.toBeNull();

    // Signal early termination
    await iter.return!();

    expect(evmCleaned).toBe(true);
    expect(stellarCleaned).toBe(true);
  }, 10_000);

  test('break from for-await loop cleans up all chains', async () => {
    let evmCleaned = false;
    let stellarCleaned = false;

    const evmSource: AsyncGenerator<EvmAnnouncement> = (async function* () {
      try {
        while (true) yield evmAnnouncement;
      } finally {
        evmCleaned = true;
      }
    })();

    const stellarSource: AsyncGenerator<StellarAnnouncement> = (async function* () {
      try {
        while (true) yield stellarAnnouncement;
      } finally {
        stellarCleaned = true;
      }
    })();

    const input: ScanAllInput = {
      evm: {
        source: evmSource,
        viewingKey: evmKeys.viewingKey,
        spendingPubKey: evmKeys.spendingPubKey,
        spendingKey: evmKeys.spendingKey,
      },
      stellar: {
        source: stellarSource,
        viewingKey: stellarKeys.viewingKey,
        spendingPubKey: stellarKeys.spendingPubKey,
        spendingScalar: stellarKeys.spendingScalar,
      },
    };

    for await (const _ of scanAll(input)) {
      break;
    }

    expect(evmCleaned).toBe(true);
    expect(stellarCleaned).toBe(true);
  }, 10_000);
});

describe('seq and timestamp', () => {
  test('per-chain seq is monotonically increasing', async () => {
    const many = Array.from({ length: 5 }, () => evmAnnouncement);

    const input: ScanAllInput = {
      evm: {
        source: toAsyncGen(many),
        viewingKey: evmKeys.viewingKey,
        spendingPubKey: evmKeys.spendingPubKey,
        spendingKey: evmKeys.spendingKey,
      },
    };

    const results = await collect(scanAll(input));
    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r.chain).toBe('evm');
      expect(typeof r.timestamp).toBe('number');
      expect(typeof r.seq).toBe('number');
    }
    const seqs = results.map((r) => r.seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });

  test('each chain has independent seq counter', async () => {
    const input: ScanAllInput = {
      evm: {
        source: toAsyncGen([evmAnnouncement, evmAnnouncement]),
        viewingKey: evmKeys.viewingKey,
        spendingPubKey: evmKeys.spendingPubKey,
        spendingKey: evmKeys.spendingKey,
      },
      stellar: {
        source: toAsyncGen([stellarAnnouncement]),
        viewingKey: stellarKeys.viewingKey,
        spendingPubKey: stellarKeys.spendingPubKey,
        spendingScalar: stellarKeys.spendingScalar,
      },
    };

    const results = await collect(scanAll(input));
    expect(results).toHaveLength(3);

    const evmSeqs = results.filter((r) => r.chain === 'evm').map((r) => r.seq);
    const stellarSeqs = results.filter((r) => r.chain === 'stellar').map((r) => r.seq);

    expect(evmSeqs).toEqual([0, 1]);
    expect(stellarSeqs).toEqual([0]);
  });
});

describe('windowed scanning', () => {
  test('processes more than WINDOW_SIZE announcements across multiple windows', async () => {
    const many = Array.from({ length: 150 }, () => evmAnnouncement);

    const input: ScanAllInput = {
      evm: {
        source: toAsyncGen(many),
        viewingKey: evmKeys.viewingKey,
        spendingPubKey: evmKeys.spendingPubKey,
        spendingKey: evmKeys.spendingKey,
      },
    };

    const results = await collect(scanAll(input));
    expect(results).toHaveLength(150);
  });
});
