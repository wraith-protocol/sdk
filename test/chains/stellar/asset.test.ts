import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @stellar/stellar-sdk BEFORE importing the module under test
// ---------------------------------------------------------------------------

const mockScVal = (value: unknown) => ({
  u32: () => value,
  get sym() {
    return value;
  },
  get str() {
    return value;
  },
  i128: { lo: () => value },
});

// Special handling for balance which uses i128
const mockBalanceScVal = (value: string) => ({
  i128: { lo: () => value },
});

const mockRetval = (value: unknown) => ({
  result: { retval: mockScVal(value) },
});

const mockSimulateTransaction = vi.fn();

vi.mock('@stellar/stellar-sdk', () => {
  const mockContract = vi.fn(() => ({
    call: vi.fn(),
  }));

  return {
    rpc: {
      Server: vi.fn(() => ({
        simulateTransaction: mockSimulateTransaction,
      })),
    },
    Account: vi.fn(),
    Contract: mockContract,
    TransactionBuilder: vi.fn(() => ({
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn(),
    })),
  };
});

// ---------------------------------------------------------------------------
// Import module under test AFTER mock is set up
// ---------------------------------------------------------------------------

import {
  getAssetMetadata,
  getAssetBalance,
  clearAssetMetadataCache,
  type AssetMetadata,
} from '../../../src/chains/stellar/asset';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_CONTRACT = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
const FIXED_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Stellar Asset Helpers', () => {
  beforeEach(() => {
    clearAssetMetadataCache();
    mockSimulateTransaction.mockClear();
  });

  // -----------------------------------------------------------------------
  // getAssetMetadata
  // -----------------------------------------------------------------------

  describe('getAssetMetadata', () => {
    it('returns metadata from the contract', async () => {
      mockSimulateTransaction
        .mockResolvedValueOnce(mockRetval('Test Asset'))
        .mockResolvedValueOnce(mockRetval('TST'))
        .mockResolvedValueOnce(mockRetval(7));

      const meta = await getAssetMetadata(FIXED_CONTRACT, 'testnet');

      expect(meta).toEqual<AssetMetadata>({ name: 'Test Asset', symbol: 'TST', decimals: 7 });
      expect(mockSimulateTransaction).toHaveBeenCalledTimes(3);
    });

    it('caches metadata for the session', async () => {
      mockSimulateTransaction
        .mockResolvedValueOnce(mockRetval('Cached'))
        .mockResolvedValueOnce(mockRetval('CCH'))
        .mockResolvedValueOnce(mockRetval(2));

      await getAssetMetadata(FIXED_CONTRACT, 'testnet');
      await getAssetMetadata(FIXED_CONTRACT, 'testnet');

      // Only the first call should hit the RPC (3 method calls)
      // Second call should use cache
      expect(mockSimulateTransaction).toHaveBeenCalledTimes(3);
    });

    it('bypasses cache when bypassCache is true', async () => {
      mockSimulateTransaction
        .mockResolvedValueOnce(mockRetval('A'))
        .mockResolvedValueOnce(mockRetval('A'))
        .mockResolvedValueOnce(mockRetval(1))
        .mockResolvedValueOnce(mockRetval('B'))
        .mockResolvedValueOnce(mockRetval('B'))
        .mockResolvedValueOnce(mockRetval(2));

      await getAssetMetadata(FIXED_CONTRACT, 'testnet');
      await getAssetMetadata(FIXED_CONTRACT, 'testnet', { bypassCache: true });

      expect(mockSimulateTransaction).toHaveBeenCalledTimes(6);
    });

    it('throws when contract returns an error', async () => {
      mockSimulateTransaction.mockResolvedValue({
        error: 'Contract panic',
      });

      await expect(getAssetMetadata(FIXED_CONTRACT, 'testnet')).rejects.toThrow(
        'SEP-41 contract call "name" failed: Contract panic',
      );
    });

    it('throws when contract returns no result', async () => {
      mockSimulateTransaction.mockResolvedValue({});

      await expect(getAssetMetadata(FIXED_CONTRACT, 'testnet')).rejects.toThrow(
        'SEP-41 contract call "name" returned no result',
      );
    });
  });

  // -----------------------------------------------------------------------
  // getAssetBalance
  // -----------------------------------------------------------------------

  describe('getAssetBalance', () => {
    it('returns the balance for an address', async () => {
      mockSimulateTransaction.mockResolvedValue({
        result: { retval: mockBalanceScVal('5000000') },
      });

      const balance = await getAssetBalance(FIXED_CONTRACT, FIXED_ADDRESS, 'testnet');

      expect(balance).toBe(5000000n);
    });

    it('throws for an invalid Stellar address', async () => {
      await expect(getAssetBalance(FIXED_CONTRACT, 'GNOTVALID', 'testnet')).rejects.toThrow(
        'Invalid Stellar address',
      );
    });

    it('throws when contract returns an error', async () => {
      mockSimulateTransaction.mockResolvedValue({
        error: 'Account not found',
      });

      await expect(getAssetBalance(FIXED_CONTRACT, FIXED_ADDRESS, 'testnet')).rejects.toThrow(
        'SEP-41 contract call "balance" failed: Account not found',
      );
    });
  });

  // -----------------------------------------------------------------------
  // clearAssetMetadataCache
  // -----------------------------------------------------------------------

  describe('clearAssetMetadataCache', () => {
    it('allows a fresh fetch after clearing', async () => {
      mockSimulateTransaction
        .mockResolvedValueOnce(mockRetval('First'))
        .mockResolvedValueOnce(mockRetval('TST'))
        .mockResolvedValueOnce(mockRetval(2))
        .mockResolvedValueOnce(mockRetval('Second'))
        .mockResolvedValueOnce(mockRetval('TST'))
        .mockResolvedValueOnce(mockRetval(2));

      await getAssetMetadata(FIXED_CONTRACT, 'testnet');
      clearAssetMetadataCache();

      const meta = await getAssetMetadata(FIXED_CONTRACT, 'testnet');
      expect(meta.name).toBe('Second');
      expect(mockSimulateTransaction).toHaveBeenCalledTimes(6);
    });
  });
});
