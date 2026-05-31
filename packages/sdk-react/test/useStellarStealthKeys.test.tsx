import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useStellarStealthKeys } from '../src/useStellarStealthKeys';
import * as stellarSdk from '@wraith-protocol/sdk/chains/stellar';

vi.mock('@wraith-protocol/sdk/chains/stellar', () => ({
  deriveStealthKeys: vi.fn(),
}));

describe('useStellarStealthKeys', () => {
  const mockSignature = '0x' + '00'.repeat(64) as `0x${string}`;
  const mockKeys = {
    spendingKey: new Uint8Array(32),
    spendingScalar: 123n,
    viewingKey: new Uint8Array(32),
    viewingScalar: 456n,
    spendingPubKey: new Uint8Array(32),
    viewingPubKey: new Uint8Array(32),
  };

  it('should return not ready when signature is null', () => {
    const { result } = renderHook(() => useStellarStealthKeys(null));

    expect(result.current.keys).toBeNull();
    expect(result.current.isReady).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should derive keys from signature', async () => {
    vi.mocked(stellarSdk.deriveStealthKeys).mockReturnValue(mockKeys);

    const { result } = renderHook(() => useStellarStealthKeys(mockSignature));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    expect(result.current.keys).toEqual(mockKeys);
    expect(result.current.error).toBeNull();
    expect(stellarSdk.deriveStealthKeys).toHaveBeenCalledWith(new Uint8Array(64));
  });

  it('should handle invalid signature length', async () => {
    const invalidSig = '0x1234' as `0x${string}`;
    const { result } = renderHook(() => useStellarStealthKeys(invalidSig));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.keys).toBeNull();
    expect(result.current.isReady).toBe(false);
    expect(result.current.error?.message).toContain('Expected 64-byte signature');
  });

  it('should memoize keys and not re-derive on re-render', async () => {
    vi.mocked(stellarSdk.deriveStealthKeys).mockReturnValue(mockKeys);

    const { result, rerender } = renderHook(() => useStellarStealthKeys(mockSignature));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    const firstKeys = result.current.keys;
    
    // Re-render with same signature
    rerender();

    expect(result.current.keys).toBe(firstKeys);
    expect(stellarSdk.deriveStealthKeys).toHaveBeenCalledTimes(1);
  });

  it('should re-derive when signature changes', async () => {
    vi.mocked(stellarSdk.deriveStealthKeys).mockReturnValue(mockKeys);

    const { result, rerender } = renderHook(
      ({ sig }) => useStellarStealthKeys(sig),
      { initialProps: { sig: mockSignature } }
    );

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    const newSignature = '0x' + 'ff'.repeat(64) as `0x${string}`;
    rerender({ sig: newSignature });

    await waitFor(() => {
      expect(stellarSdk.deriveStealthKeys).toHaveBeenCalledTimes(2);
    });
  });

  it('should handle derivation errors', async () => {
    const error = new Error('Derivation failed');
    vi.mocked(stellarSdk.deriveStealthKeys).mockImplementation(() => {
      throw error;
    });

    const { result } = renderHook(() => useStellarStealthKeys(mockSignature));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.keys).toBeNull();
    expect(result.current.isReady).toBe(false);
    expect(result.current.error?.message).toBe('Derivation failed');
  });
});
