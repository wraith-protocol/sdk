import { describe, test, expect } from 'vitest';
import { deriveStealthKeys } from '../../../src/chains/stellar/keys';
import { encodeStealthMetaAddress } from '../../../src/chains/stellar/meta-address';
import {
  buildBatchSendTx,
  buildAnnouncementData,
  STELLAR_MAX_OPERATIONS,
  DEFAULT_BASE_FEE,
  DEFAULT_BATCH_SENDER_THRESHOLD,
} from '../../../src/chains/stellar/tx-builder';
import type { StealthPayment } from '../../../src/chains/stellar/types';

const testSig = new Uint8Array(64).fill(0xaa);
const networkPassphrase = 'Test SDF Network ; September 2015';

// Create a mock Stellar Account object
const { Account } = require('@stellar/stellar-sdk');
const sourceAccount = new Account(
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  '123456789',
);

describe('tx-builder: buildBatchSendTx', () => {
  const keys = deriveStealthKeys(testSig);
  const metaAddress = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);

  test('builds transaction with 1 destination', () => {
    const payments: StealthPayment[] = [
      {
        metaAddress,
        amount: '10',
      },
    ];

    const result = buildBatchSendTx({
      payments,
      sourceAccount,
      networkPassphrase,
    });

    expect(result.transaction).toBeDefined();
    expect(result.stealthAddresses).toHaveLength(1);
    expect(result.totalFee).toBe(DEFAULT_BASE_FEE);
    expect(result.usedBatchSender).toBe(false);
    expect(result.stealthAddresses[0].stealthAddress).toMatch(/^G[A-Z2-7]{55}$/);
  });

  test('builds transaction with 5 destinations', () => {
    const payments: StealthPayment[] = Array.from({ length: 5 }, () => ({
      metaAddress,
      amount: '5',
    }));

    const result = buildBatchSendTx({
      payments,
      sourceAccount,
      networkPassphrase,
    });

    expect(result.transaction).toBeDefined();
    expect(result.stealthAddresses).toHaveLength(5);
    expect(result.totalFee).toBe(5 * DEFAULT_BASE_FEE);
    expect(result.usedBatchSender).toBe(false);

    // Verify all stealth addresses are unique (different ephemeral keys)
    const addresses = result.stealthAddresses.map((s) => s.stealthAddress);
    const uniqueAddresses = new Set(addresses);
    expect(uniqueAddresses.size).toBe(5);
  });

  test('builds transaction with 20 destinations', () => {
    const payments: StealthPayment[] = Array.from({ length: 20 }, () => ({
      metaAddress,
      amount: '1',
    }));

    const result = buildBatchSendTx({
      payments,
      sourceAccount,
      networkPassphrase,
    });

    expect(result.transaction).toBeDefined();
    expect(result.stealthAddresses).toHaveLength(20);
    expect(result.totalFee).toBe(20 * DEFAULT_BASE_FEE);
    expect(result.usedBatchSender).toBe(false);

    // Verify all stealth addresses are unique
    const addresses = result.stealthAddresses.map((s) => s.stealthAddress);
    const uniqueAddresses = new Set(addresses);
    expect(uniqueAddresses.size).toBe(20);
  });

  test('rejects empty payments array', () => {
    expect(() =>
      buildBatchSendTx({
        payments: [],
        sourceAccount,
        networkPassphrase,
      }),
    ).toThrow('Payments array cannot be empty');
  });

  test('rejects batches over operation count cap', () => {
    const payments: StealthPayment[] = Array.from({ length: STELLAR_MAX_OPERATIONS + 1 }, () => ({
      metaAddress,
      amount: '1',
    }));

    expect(() =>
      buildBatchSendTx({
        payments,
        sourceAccount,
        networkPassphrase,
      }),
    ).toThrow(
      new RegExp(
        `Payment count \\(${STELLAR_MAX_OPERATIONS + 1}\\) exceeds maximum operations per transaction \\(${STELLAR_MAX_OPERATIONS}\\)`,
      ),
    );
  });

  test('rejects batches over custom max operations', () => {
    const customMax = 10;
    const payments: StealthPayment[] = Array.from({ length: 11 }, () => ({
      metaAddress,
      amount: '1',
    }));

    expect(() =>
      buildBatchSendTx({
        payments,
        sourceAccount,
        networkPassphrase,
        maxOperations: customMax,
      }),
    ).toThrow(
      new RegExp(
        `Payment count \\(11\\) exceeds maximum operations per transaction \\(${customMax}\\)`,
      ),
    );
  });

  test('accepts batch exactly at operation count cap', () => {
    const payments: StealthPayment[] = Array.from({ length: STELLAR_MAX_OPERATIONS }, () => ({
      metaAddress,
      amount: '1',
    }));

    const result = buildBatchSendTx({
      payments,
      sourceAccount,
      networkPassphrase,
    });

    expect(result.transaction).toBeDefined();
    expect(result.stealthAddresses).toHaveLength(STELLAR_MAX_OPERATIONS);
    expect(result.totalFee).toBe(STELLAR_MAX_OPERATIONS * DEFAULT_BASE_FEE);
  });

  test('applies custom base fee', () => {
    const customFee = 200;
    const payments: StealthPayment[] = [
      {
        metaAddress,
        amount: '10',
      },
    ];

    const result = buildBatchSendTx({
      payments,
      sourceAccount,
      networkPassphrase,
      baseFee: customFee,
    });

    expect(result.totalFee).toBe(customFee);
  });

  test('scales fee with operation count', () => {
    const customFee = 150;
    const payments: StealthPayment[] = Array.from({ length: 5 }, () => ({
      metaAddress,
      amount: '1',
    }));

    const result = buildBatchSendTx({
      payments,
      sourceAccount,
      networkPassphrase,
      baseFee: customFee,
    });

    expect(result.totalFee).toBe(5 * customFee);
  });

  test('adds text memo when provided', () => {
    const memo = 'Payroll Q1';
    const payments: StealthPayment[] = [
      {
        metaAddress,
        amount: '10',
      },
    ];

    const result = buildBatchSendTx({
      payments,
      sourceAccount,
      networkPassphrase,
      memo,
    });

    expect(result.transaction).toBeDefined();
    const txMemo = result.transaction.memo;
    expect(txMemo).toBeDefined();
  });

  test('rejects memo that is too long', () => {
    const longMemo = 'a'.repeat(65);
    const payments: StealthPayment[] = [
      {
        metaAddress,
        amount: '10',
      },
    ];

    expect(() =>
      buildBatchSendTx({
        payments,
        sourceAccount,
        networkPassphrase,
        memo: longMemo,
      }),
    ).toThrow('Memo too long');
  });

  test('throws error when batchSenderContract is provided but not implemented', () => {
    const payments: StealthPayment[] = Array.from(
      { length: DEFAULT_BATCH_SENDER_THRESHOLD },
      () => ({
        metaAddress,
        amount: '1',
      }),
    );

    expect(() =>
      buildBatchSendTx({
        payments,
        sourceAccount,
        networkPassphrase,
        batchSenderContract: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      }),
    ).toThrow('stealth-batch-sender contract integration not yet implemented');
  });

  test('does not use batch sender below threshold', () => {
    const payments: StealthPayment[] = Array.from(
      { length: DEFAULT_BATCH_SENDER_THRESHOLD - 1 },
      () => ({
        metaAddress,
        amount: '1',
      }),
    );

    const result = buildBatchSendTx({
      payments,
      sourceAccount,
      networkPassphrase,
      batchSenderContract: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    });

    expect(result.usedBatchSender).toBe(false);
  });
});

describe('tx-builder: buildAnnouncementData', () => {
  const keys = deriveStealthKeys(testSig);
  const metaAddress = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
  const caller = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

  test('builds announcement data for single stealth address', () => {
    const payments: StealthPayment[] = [
      {
        metaAddress,
        amount: '10',
      },
    ];

    const txResult = buildBatchSendTx({
      payments,
      sourceAccount,
      networkPassphrase,
    });

    const announcementData = buildAnnouncementData(txResult.stealthAddresses, caller);

    expect(announcementData).toHaveLength(1);
    expect(announcementData[0].schemeId).toBe(1);
    expect(announcementData[0].stealthAddress).toBe(txResult.stealthAddresses[0].stealthAddress);
    expect(announcementData[0].caller).toBe(caller);
    expect(announcementData[0].ephemeralPubKey).toMatch(/^[0-9a-f]{64}$/);
    expect(announcementData[0].metadata).toMatch(/^[0-9a-f]{2}$/);
  });

  test('builds announcement data for multiple stealth addresses', () => {
    const payments: StealthPayment[] = Array.from({ length: 5 }, () => ({
      metaAddress,
      amount: '1',
    }));

    const txResult = buildBatchSendTx({
      payments,
      sourceAccount,
      networkPassphrase,
    });

    const announcementData = buildAnnouncementData(txResult.stealthAddresses, caller);

    expect(announcementData).toHaveLength(5);

    // Verify each announcement has correct structure
    announcementData.forEach((ann, i) => {
      expect(ann.schemeId).toBe(1);
      expect(ann.stealthAddress).toBe(txResult.stealthAddresses[i].stealthAddress);
      expect(ann.caller).toBe(caller);
      expect(ann.ephemeralPubKey).toMatch(/^[0-9a-f]{64}$/);
      expect(ann.metadata).toMatch(/^[0-9a-f]{2}$/);
    });

    // Verify ephemeral keys are unique
    const ephKeys = announcementData.map((a) => a.ephemeralPubKey);
    const uniqueKeys = new Set(ephKeys);
    expect(uniqueKeys.size).toBe(5);
  });
});

describe('tx-builder: constants', () => {
  test('exports correct max operations constant', () => {
    expect(STELLAR_MAX_OPERATIONS).toBe(100);
  });

  test('exports correct default base fee constant', () => {
    expect(DEFAULT_BASE_FEE).toBe(100);
  });

  test('exports correct default batch sender threshold', () => {
    expect(DEFAULT_BATCH_SENDER_THRESHOLD).toBe(10);
  });
});
