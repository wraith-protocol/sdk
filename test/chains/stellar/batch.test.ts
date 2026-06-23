import { describe, test, expect } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import {
  StellarBatchBuilder,
  encodeAnnouncementData,
  decodeAnnouncementData,
} from '../../../src/chains/stellar/batch';
import type { StealthPaymentConfig, BatchConfig } from '../../../src/chains/stellar/batch';
import { SCHEME_ID } from '../../../src/chains/stellar/constants';

const SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const DEST = 'GCVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVH7N';
const DEST2 = 'GC53XO53XO53XO53XO53XO53XO53XO53XO53XO53XO53XO53XO53XUGE';
const EPH_PUB_KEY = 'aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd';
const VIEW_TAG = 42;

function makePayment(overrides?: Partial<StealthPaymentConfig>): StealthPaymentConfig {
  return {
    destination: DEST,
    amount: '10',
    asset: 'native',
    ephemeralPubKey: EPH_PUB_KEY,
    viewTag: VIEW_TAG,
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<BatchConfig>): BatchConfig {
  return {
    source: SOURCE,
    sequence: '1234',
    networkPassphrase: Networks.TESTNET,
    ...overrides,
  };
}

const ephBytes = Buffer.from(EPH_PUB_KEY, 'hex');

describe('encodeAnnouncementData / decodeAnnouncementData', () => {
  test('roundtrip', () => {
    const encoded = encodeAnnouncementData(ephBytes, VIEW_TAG);
    expect(encoded.length).toBe(34);
    expect(encoded[0]).toBe(SCHEME_ID);

    const decoded = decodeAnnouncementData(encoded);
    expect(decoded.schemeId).toBe(SCHEME_ID);
    expect(Buffer.from(decoded.ephemeralPubKey).toString('hex')).toBe(EPH_PUB_KEY);
    expect(decoded.viewTag).toBe(VIEW_TAG);
  });

  test('roundtrip with different values', () => {
    const eph = '1122334411223344112233441122334411223344112233441122334411223344';
    const tag = 200;
    const ephBytes2 = Buffer.from(eph, 'hex');
    const encoded = encodeAnnouncementData(ephBytes2, tag);
    expect(encoded.length).toBe(34);

    const decoded = decodeAnnouncementData(encoded);
    expect(decoded.schemeId).toBe(SCHEME_ID);
    expect(Buffer.from(decoded.ephemeralPubKey).toString('hex')).toBe(eph);
    expect(decoded.viewTag).toBe(tag);
  });

  test('throws on short data', () => {
    expect(() => decodeAnnouncementData(new Uint8Array(10))).toThrow(
      'Invalid announcement data length',
    );
    expect(() => decodeAnnouncementData(new Uint8Array(33))).toThrow(
      'Invalid announcement data length',
    );
  });
});

describe('StellarBatchBuilder', () => {
  test('builds a single payment transaction', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    builder.addPayment(makePayment());
    const result = builder.build();

    expect(result.transactions).toHaveLength(1);
    expect(result.txCount).toBe(1);
    expect(result.paymentCount).toBe(1);
    expect(result.totalFee).toBe(200); // 2 ops * 100 stroops
    expect(typeof result.transactions[0]).toBe('string');
    expect(result.transactions[0].length).toBeGreaterThan(100);
  });

  test('builds multiple payments in one transaction', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    builder.addPayment(makePayment({ destination: DEST }));
    builder.addPayment(makePayment({ destination: DEST2 }));
    const result = builder.build();

    expect(result.transactions).toHaveLength(1);
    expect(result.paymentCount).toBe(2);
    expect(result.totalFee).toBe(400); // 4 ops * 100 stroops
  });

  test('splits into multiple transactions when exceeding 50 payments', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    for (let i = 0; i < 60; i++) {
      builder.addPayment(makePayment({ destination: DEST }));
    }
    expect(builder.expectedTransactionCount).toBe(2);

    const result = builder.build();
    expect(result.transactions).toHaveLength(2);
    expect(result.paymentCount).toBe(60);

    // First tx: 50 payments * 2 ops = 100 ops, second: 10 payments * 2 = 20 ops
    const totalFee = 60 * 2 * 100;
    expect(result.totalFee).toBe(totalFee);

    // Verify splitting boundary
    expect(builder.paymentCount).toBe(60);
    expect(builder.operationCount).toBe(120);
  });

  test('splits exactly at 51 payments', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    for (let i = 0; i < 51; i++) {
      builder.addPayment(makePayment());
    }
    expect(builder.expectedTransactionCount).toBe(2);
    const result = builder.build();
    expect(result.transactions).toHaveLength(2);
    expect(result.paymentCount).toBe(51);
  });

  test('single tx at exactly 50 payments', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    for (let i = 0; i < 50; i++) {
      builder.addPayment(makePayment());
    }
    expect(builder.expectedTransactionCount).toBe(1);
    const result = builder.build();
    expect(result.transactions).toHaveLength(1);
    expect(result.paymentCount).toBe(50);
  });

  test('splits at 101 payments', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    for (let i = 0; i < 101; i++) {
      builder.addPayment(makePayment());
    }
    expect(builder.expectedTransactionCount).toBe(3);
    const result = builder.build();
    expect(result.transactions).toHaveLength(3);
    expect(result.paymentCount).toBe(101);
  });

  test('caches build result', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    builder.addPayment(makePayment());
    const r1 = builder.build();
    const r2 = builder.build();
    expect(r1).toBe(r2);
  });

  test('invalidates cache after addPayment', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    builder.addPayment(makePayment());
    const r1 = builder.build();
    builder.addPayment(makePayment({ destination: DEST2 }));
    const r2 = builder.build();
    expect(r1.paymentCount).toBe(1);
    expect(r2.paymentCount).toBe(2);
    expect(r1.transactions).not.toEqual(r2.transactions);
  });

  test('throws on empty batch', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    expect(() => builder.build()).toThrow('No payments added');
  });

  test('expectedTransactionCount is 0 for empty builder', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    expect(builder.expectedTransactionCount).toBe(0);
    expect(builder.paymentCount).toBe(0);
    expect(builder.operationCount).toBe(0);
  });

  test('paymentCount and operationCount reflect added payments', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    expect(builder.paymentCount).toBe(0);
    expect(builder.operationCount).toBe(0);
    builder.addPayment(makePayment());
    expect(builder.paymentCount).toBe(1);
    expect(builder.operationCount).toBe(2);
    builder.addPayment(makePayment());
    expect(builder.paymentCount).toBe(2);
    expect(builder.operationCount).toBe(4);
  });
});

describe('validation', () => {
  test('rejects invalid source address', () => {
    expect(() => new StellarBatchBuilder(makeConfig({ source: 'invalid' }))).toThrow(
      'Invalid source address',
    );
  });

  test('rejects invalid destination address', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    expect(() => builder.addPayment(makePayment({ destination: 'invalid' }))).toThrow(
      'destination',
    );
  });

  test('rejects invalid ephemeral pub key (wrong length)', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    expect(() => builder.addPayment(makePayment({ ephemeralPubKey: 'aabb' }))).toThrow(
      'expected 32 bytes',
    );
  });

  test('rejects invalid view tag (>255)', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    expect(() => builder.addPayment(makePayment({ viewTag: 300 }))).toThrow(
      'viewTag: expected 0–255',
    );
  });

  test('rejects invalid view tag (<0)', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    expect(() => builder.addPayment(makePayment({ viewTag: -1 }))).toThrow(
      'viewTag: expected 0–255',
    );
  });

  test('rejects negative amount', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    expect(() => builder.addPayment(makePayment({ amount: '-10' }))).toThrow(
      'expected positive number',
    );
  });

  test('rejects zero amount', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    expect(() => builder.addPayment(makePayment({ amount: '0' }))).toThrow(
      'expected positive number',
    );
  });

  test('rejects non-numeric amount', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    expect(() => builder.addPayment(makePayment({ amount: 'abc' }))).toThrow(
      'expected positive number',
    );
  });

  test('rejects custom asset without issuer', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    expect(() => builder.addPayment(makePayment({ asset: 'USDC' }))).toThrow(
      'assetIssuer is required',
    );
  });

  test('accepts custom asset with issuer', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    expect(() =>
      builder.addPayment(
        makePayment({
          asset: 'USDC',
          assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        }),
      ),
    ).not.toThrow();
  });

  test('rejects custom asset with invalid issuer', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    expect(() =>
      builder.addPayment(
        makePayment({
          asset: 'USDC',
          assetIssuer: 'invalid',
        }),
      ),
    ).toThrow('assetIssuer');
  });

  test('accepts XLM as asset alias', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    expect(() => builder.addPayment(makePayment({ asset: 'XLM' }))).not.toThrow();
  });
});

describe('validateBalance', () => {
  test('passes with sufficient balance', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    builder.addPayment(makePayment());
    expect(() => builder.validateBalance('1')).not.toThrow();
  });

  test('passes with exact balance', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    builder.addPayment(makePayment());
    // 2 ops * 100 stroops = 200 stroops = 0.00002 XLM
    expect(() => builder.validateBalance('0.00002')).not.toThrow();
  });

  test('throws with insufficient balance', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    builder.addPayment(makePayment());
    expect(() => builder.validateBalance('0.00001')).toThrow('Insufficient balance');
  });

  test('throws with invalid balance string', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    builder.addPayment(makePayment());
    expect(() => builder.validateBalance('abc')).toThrow('Invalid balance');
  });

  test('throws with negative balance', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    builder.addPayment(makePayment());
    expect(() => builder.validateBalance('-1')).toThrow('Invalid balance');
  });

  test('accounts for multiple payments correctly', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    builder.addPayment(makePayment());
    builder.addPayment(makePayment());
    // 4 ops * 100 = 400 stroops = 0.00004 XLM
    expect(() => builder.validateBalance('0.00004')).not.toThrow();
    expect(() => builder.validateBalance('0.00003')).toThrow('Insufficient balance');
  });
});

describe('custom fee per op', () => {
  test('uses custom fee per operation', () => {
    const builder = new StellarBatchBuilder(makeConfig({ feePerOp: 200 }));
    builder.addPayment(makePayment());
    builder.addPayment(makePayment());
    const result = builder.build();
    // 4 ops * 200 = 800 stroops
    expect(result.totalFee).toBe(800);
  });

  test('validateBalance accounts for custom fee', () => {
    const builder = new StellarBatchBuilder(makeConfig({ feePerOp: 1000 }));
    builder.addPayment(makePayment());
    // 2 ops * 1000 = 2000 stroops = 0.0002 XLM
    expect(() => builder.validateBalance('0.0002')).not.toThrow();
    expect(() => builder.validateBalance('0.00019')).toThrow('Insufficient balance');
  });
});

describe('chained addPayment calls', () => {
  test('supports method chaining', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    builder.addPayment(makePayment()).addPayment(makePayment()).addPayment(makePayment());
    expect(builder.paymentCount).toBe(3);
  });
});

describe('non-native asset in transaction', () => {
  test('builds transaction with custom asset', () => {
    const builder = new StellarBatchBuilder(makeConfig());
    builder.addPayment(
      makePayment({
        asset: 'USDC',
        assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      }),
    );
    const result = builder.build();
    expect(result.transactions).toHaveLength(1);
  });
});
