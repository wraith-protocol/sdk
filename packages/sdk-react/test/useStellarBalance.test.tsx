import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useStellarBalance } from '../src/useStellarBalance';

// Mock Stellar SDK
vi.mock('@stellar/stellar-sdk', () => ({
  Server: vi.fn().mockImplementation(() => ({
    loadAccount: vi.fn(),
  })),
}));

describe('useStellarBalance', () => {
  const mockAddress = 'GTEST...';
  const mockAccount = {
    balances: [
      {
        asset_type: 'native',
        balance: '100.5000000',
      },
      {
        asset_type: 'credit_alphanum4',
        asset_code: 'USDC',
        asset_issuer: 'GISSUER...',
        balance: '50.0000000',
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not fetch when address is null', () => {
    const { result } = renderHook(() => useStellarBalance(null));

    expect(result.current.xlm).toBeNull();
    expect(result.current.assets).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('should fetch balance on mount', async () => {
    const { Server } = await import('@stellar/stellar-sdk');
    const mockLoadAccount = vi.fn().mockResolvedValue(mockAccount);
    vi.mocked(Server).mockImplementation(() => ({
      loadAccount: mockLoadAccount,
    }) as any);

    const { result } = renderHook(() => useStellarBalance(mockAddress));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.xlm).toBe('100.5000000');
    expect(result.current.assets).toEqual([
      {
        code: 'USDC',
        issuer: 'GISSUER...',
        balance: '50.0000000',
      },
    ]);
    expect(mockLoadAccount).toHaveBeenCalledWith(mockAddress);
  });

  it('should poll at specified interval', async () => {
    const { Server } = await import('@stellar/stellar-sdk');
    const mockLoadAccount = vi.fn().mockResolvedValue(mockAccount);
    vi.mocked(Server).mockImplementation(() => ({
      loadAccount: mockLoadAccount,
    }) as any);

    renderHook(() => useStellarBalance(mockAddress, { intervalMs: 5000 }));

    await waitFor(() => {
      expect(mockLoadAccount).toHaveBeenCalledTimes(1);
    });

    // Advance time by 5 seconds
    vi.advanceTimersByTime(5000);

    await waitFor(() => {
      expect(mockLoadAccount).toHaveBeenCalledTimes(2);
    });
  });

  it('should not fetch when disabled', () => {
    const { result } = renderHook(() =>
      useStellarBalance(mockAddress, { enabled: false })
    );

    expect(result.current.isLoading).toBe(false);
  });

  it('should handle fetch errors', async () => {
    const { Server } = await import('@stellar/stellar-sdk');
    const error = new Error('Account not found');
    const mockLoadAccount = vi.fn().mockRejectedValue(error);
    vi.mocked(Server).mockImplementation(() => ({
      loadAccount: mockLoadAccount,
    }) as any);

    const { result } = renderHook(() => useStellarBalance(mockAddress));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error?.message).toBe('Account not found');
    expect(result.current.isLoading).toBe(false);
  });

  it('should support manual refetch', async () => {
    const { Server } = await import('@stellar/stellar-sdk');
    const mockLoadAccount = vi.fn().mockResolvedValue(mockAccount);
    vi.mocked(Server).mockImplementation(() => ({
      loadAccount: mockLoadAccount,
    }) as any);

    const { result } = renderHook(() => useStellarBalance(mockAddress));

    await waitFor(() => {
      expect(mockLoadAccount).toHaveBeenCalledTimes(1);
    });

    // Manual refetch
    await result.current.refetch();

    expect(mockLoadAccount).toHaveBeenCalledTimes(2);
  });

  it('should prevent concurrent fetches', async () => {
    const { Server } = await import('@stellar/stellar-sdk');
    let resolvePromise: () => void;
    const promise = new Promise<any>((resolve) => {
      resolvePromise = () => resolve(mockAccount);
    });

    const mockLoadAccount = vi.fn().mockReturnValue(promise);
    vi.mocked(Server).mockImplementation(() => ({
      loadAccount: mockLoadAccount,
    }) as any);

    const { result } = renderHook(() => useStellarBalance(mockAddress));

    // Try to refetch while loading
    result.current.refetch();
    result.current.refetch();

    resolvePromise!();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should only have called once despite multiple refetch attempts
    expect(mockLoadAccount).toHaveBeenCalledTimes(1);
  });

  it('should handle accounts with only XLM', async () => {
    const { Server } = await import('@stellar/stellar-sdk');
    const xlmOnlyAccount = {
      balances: [
        {
          asset_type: 'native',
          balance: '200.0000000',
        },
      ],
    };

    const mockLoadAccount = vi.fn().mockResolvedValue(xlmOnlyAccount);
    vi.mocked(Server).mockImplementation(() => ({
      loadAccount: mockLoadAccount,
    }) as any);

    const { result } = renderHook(() => useStellarBalance(mockAddress));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.xlm).toBe('200.0000000');
    expect(result.current.assets).toEqual([]);
  });
});
