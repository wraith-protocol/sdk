import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useStellarSendStealthPayment } from '../src/useStellarSendStealthPayment';
import * as stellarSdk from '@wraith-protocol/sdk/chains/stellar';

vi.mock('@wraith-protocol/sdk/chains/stellar', () => ({
  decodeStealthMetaAddress: vi.fn(),
  generateStealthAddress: vi.fn(),
}));

describe('useStellarSendStealthPayment', () => {
  const mockMetaAddress = {
    prefix: 'st:stellar',
    spendingPubKey: new Uint8Array(32),
    viewingPubKey: new Uint8Array(32),
  };

  const mockStealthAddress = {
    stealthAddress: 'GSTEALTH...',
    ephemeralPubKey: new Uint8Array(32),
    viewTag: 42,
  };

  it('should initialize with idle status', () => {
    const { result } = renderHook(() => useStellarSendStealthPayment());

    expect(result.current.status).toBe('idle');
    expect(result.current.txHash).toBeNull();
    expect(result.current.stealthAddress).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should generate stealth address on send', async () => {
    vi.mocked(stellarSdk.decodeStealthMetaAddress).mockReturnValue(mockMetaAddress);
    vi.mocked(stellarSdk.generateStealthAddress).mockReturnValue(mockStealthAddress);

    const { result } = renderHook(() => useStellarSendStealthPayment());

    await act(async () => {
      try {
        await result.current.send({
          recipientMetaAddress: 'st:stellar:0x...',
          amount: '10',
        });
      } catch {
        // Expected to throw since tx building is not implemented
      }
    });

    expect(stellarSdk.decodeStealthMetaAddress).toHaveBeenCalledWith('st:stellar:0x...');
    expect(stellarSdk.generateStealthAddress).toHaveBeenCalledWith(
      mockMetaAddress.spendingPubKey,
      mockMetaAddress.viewingPubKey
    );
    expect(result.current.stealthAddress).toBe('GSTEALTH...');
  });

  it('should handle errors during send', async () => {
    const error = new Error('Invalid meta-address');
    vi.mocked(stellarSdk.decodeStealthMetaAddress).mockImplementation(() => {
      throw error;
    });

    const { result } = renderHook(() => useStellarSendStealthPayment());

    await act(async () => {
      try {
        await result.current.send({
          recipientMetaAddress: 'invalid',
          amount: '10',
        });
      } catch {
        // Expected
      }
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Invalid meta-address');
  });

  it('should reset state', async () => {
    vi.mocked(stellarSdk.decodeStealthMetaAddress).mockReturnValue(mockMetaAddress);
    vi.mocked(stellarSdk.generateStealthAddress).mockReturnValue(mockStealthAddress);

    const { result } = renderHook(() => useStellarSendStealthPayment());

    await act(async () => {
      try {
        await result.current.send({
          recipientMetaAddress: 'st:stellar:0x...',
          amount: '10',
        });
      } catch {
        // Expected
      }
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.txHash).toBeNull();
    expect(result.current.stealthAddress).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should transition through status states', async () => {
    vi.mocked(stellarSdk.decodeStealthMetaAddress).mockReturnValue(mockMetaAddress);
    vi.mocked(stellarSdk.generateStealthAddress).mockReturnValue(mockStealthAddress);

    const { result } = renderHook(() => useStellarSendStealthPayment());

    const statuses: string[] = [];

    await act(async () => {
      const promise = result.current.send({
        recipientMetaAddress: 'st:stellar:0x...',
        amount: '10',
      });

      statuses.push(result.current.status);

      try {
        await promise;
      } catch {
        // Expected
      }
    });

    statuses.push(result.current.status);

    expect(statuses).toContain('preparing');
    expect(statuses).toContain('signing');
    expect(result.current.status).toBe('error'); // Final state since tx building not implemented
  });
});
