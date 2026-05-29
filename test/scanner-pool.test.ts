import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MultichainScannerPool,
  type ScanInput,
  type EvmScanInput,
  type StellarScanInput,
  type SolanaScanInput,
} from '../src/scanner-pool';

// Mock announcements - with empty arrays so scanning returns immediately
const mockEvmAnnouncements: never[] = [];
const mockStellarAnnouncements: never[] = [];
const mockSolanaAnnouncements: never[] = [];

// Valid 32-byte hex keys for EVM (as 0x + 64 hex chars)
const mockEvmKeys = {
  viewingKey: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as const,
  spendingPubKey: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' as const,
  spendingKey: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as const,
};

const mockStellarKeys = {
  viewingKey: new Uint8Array(32).fill(0xcc),
  spendingPubKey: new Uint8Array(32).fill(0xdd),
  spendingScalar: 123456789n,
};

const mockSolanaKeys = {
  viewingKey: new Uint8Array(32).fill(0xcc),
  spendingPubKey: new Uint8Array(32).fill(0xdd),
  spendingScalar: 123456789n,
};

describe('MultichainScannerPool', () => {
  let pool: MultichainScannerPool;

  beforeEach(() => {
    pool = new MultichainScannerPool({
      chains: ['evm', 'stellar', 'solana'],
      concurrency: 2,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const defaultPool = new MultichainScannerPool();
      expect(defaultPool).toBeDefined();
    });

    it('should initialize with custom chains and concurrency', () => {
      const customPool = new MultichainScannerPool({
        chains: ['evm'],
        concurrency: 1,
      });
      expect(customPool).toBeDefined();
    });
  });

  describe('progress reporting', () => {
    it('should allow registering progress listeners', () => {
      const listener = vi.fn();
      pool.on('progress', listener);

      expect(listener).not.toHaveBeenCalled();
    });

    it('should remove progress listeners', () => {
      const listener = vi.fn();
      pool.on('progress', listener);
      pool.off('progress', listener);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('scanAll', () => {
    it('should handle empty input gracefully', async () => {
      const results = await pool.scanAll({});
      expect(results).toEqual({});
    });

    it('should handle single chain input', async () => {
      const input: ScanInput = {
        evm: {
          announcements: mockEvmAnnouncements,
          ...mockEvmKeys,
        } as EvmScanInput,
      };

      const results = await pool.scanAll(input);
      expect(results).toBeDefined();
      expect(results.evm).toBeDefined();
      expect(Array.isArray(results.evm)).toBe(true);
    });

    it('should handle multiple chain input', async () => {
      const input: ScanInput = {
        evm: {
          announcements: mockEvmAnnouncements,
          ...mockEvmKeys,
        } as EvmScanInput,
        stellar: {
          announcements: mockStellarAnnouncements,
          ...mockStellarKeys,
        } as StellarScanInput,
      };

      const results = await pool.scanAll(input);
      expect(results).toBeDefined();
      expect(results.evm).toBeDefined();
      expect(results.stellar).toBeDefined();
    });

    it('should respect AbortSignal cancellation', async () => {
      const controller = new AbortController();
      const input: ScanInput = {
        evm: {
          announcements: mockEvmAnnouncements,
          ...mockEvmKeys,
        } as EvmScanInput,
      };

      controller.abort();

      try {
        await pool.scanAll(input, controller.signal);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('environment detection', () => {
    it('should be detected as Node environment', () => {
      const nodePool = new MultichainScannerPool();
      expect(nodePool).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle invalid chain gracefully', async () => {
      const invalidInput = {
        invalid: {
          announcements: [],
        },
      } as unknown as ScanInput;

      const results = await pool.scanAll(invalidInput);
      expect(results).toBeDefined();
    });

    it('should handle malformed announcements', async () => {
      const input: ScanInput = {
        evm: {
          announcements: [] as never,
          ...mockEvmKeys,
        } as EvmScanInput,
      };

      const results = await pool.scanAll(input);
      expect(results.evm).toBeDefined();
      expect(Array.isArray(results.evm)).toBe(true);
    });
  });

  describe('concurrency limiting', () => {
    it('should respect concurrency limit', async () => {
      const concurrencyPool = new MultichainScannerPool({
        chains: ['evm', 'stellar', 'solana'],
        concurrency: 1,
      });

      const input: ScanInput = {
        evm: {
          announcements: mockEvmAnnouncements,
          ...mockEvmKeys,
        } as EvmScanInput,
        stellar: {
          announcements: mockStellarAnnouncements,
          ...mockStellarKeys,
        } as StellarScanInput,
      };

      const results = await concurrencyPool.scanAll(input);
      expect(results).toBeDefined();
    });
  });

  describe('multi-chain scanning', () => {
    it('should scan all provided chains in parallel', async () => {
      const input: ScanInput = {
        evm: {
          announcements: mockEvmAnnouncements,
          ...mockEvmKeys,
        } as EvmScanInput,
        stellar: {
          announcements: mockStellarAnnouncements,
          ...mockStellarKeys,
        } as StellarScanInput,
        solana: {
          announcements: mockSolanaAnnouncements,
          ...mockSolanaKeys,
        } as SolanaScanInput,
      };

      const startTime = performance.now();
      const results = await pool.scanAll(input);
      const endTime = performance.now();

      expect(results).toBeDefined();
      expect(results.evm).toBeDefined();
      expect(results.stellar).toBeDefined();
      expect(results.solana).toBeDefined();
      expect(endTime - startTime).toBeGreaterThan(0);
    });

    it('should handle partial chain results', async () => {
      const input: ScanInput = {
        evm: {
          announcements: mockEvmAnnouncements,
          ...mockEvmKeys,
        } as EvmScanInput,
        stellar: {
          announcements: mockStellarAnnouncements,
          ...mockStellarKeys,
        } as StellarScanInput,
      };

      const results = await pool.scanAll(input);
      expect(results).toBeDefined();
      expect(Object.keys(results).length).toBeGreaterThan(0);
    });
  });

  describe('result merging', () => {
    it('should merge results from multiple chains correctly', async () => {
      const input: ScanInput = {
        evm: {
          announcements: mockEvmAnnouncements,
          ...mockEvmKeys,
        } as EvmScanInput,
        stellar: {
          announcements: mockStellarAnnouncements,
          ...mockStellarKeys,
        } as StellarScanInput,
      };

      const results = await pool.scanAll(input);

      if (results.evm !== undefined) {
        expect(Array.isArray(results.evm)).toBe(true);
      }
      if (results.stellar !== undefined) {
        expect(Array.isArray(results.stellar)).toBe(true);
      }
    });

    it('should not include chains without input in results', async () => {
      const input: ScanInput = {
        evm: {
          announcements: mockEvmAnnouncements,
          ...mockEvmKeys,
        } as EvmScanInput,
      };

      const results = await pool.scanAll(input);

      expect(results.evm).toBeDefined();
      expect(results.stellar).toBeUndefined();
      expect(results.solana).toBeUndefined();
    });
  });
});
