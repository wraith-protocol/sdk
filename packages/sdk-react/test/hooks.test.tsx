// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useStellarStealthKeys, useStellarBalance } from '../src/hooks';
import {
  deriveStealthKeys,
  deriveStealthKeysFromSigner,
} from '@wraith-protocol/sdk/chains/stellar';

vi.mock('@wraith-protocol/sdk/chains/stellar', async () => {
  const original: any = await vi.importActual('@wraith-protocol/sdk/chains/stellar');
  return {
    ...original,
    deriveStealthKeys: vi.fn(() => ({ viewPrivateKey: 'vpk', spendPrivateKey: 'spk' })),
    deriveStealthKeysFromSigner: vi.fn(() =>
      Promise.resolve({ viewPrivateKey: 'vpk-signer', spendPrivateKey: 'spk-signer' }),
    ),
    fetchAnnouncements: vi.fn(() => Promise.resolve({ announcements: [] })),
    buildStealthPayment: vi.fn(() => Promise.resolve({})),
    getDeployment: vi.fn(() => ({ rpcUrl: 'https://rpc', contracts: { names: 'foo' } })),
  };
});

vi.mock('@stellar/stellar-sdk', async () => {
  const original: any = await vi.importActual('@stellar/stellar-sdk');
  return {
    ...original,
    Horizon: {
      Server: vi.fn().mockImplementation(() => ({
        loadAccount: vi.fn().mockResolvedValue({
          balances: [{ asset_type: 'native', balance: '10.5' }],
        }),
      })),
    },
  };
});

describe('useStellarStealthKeys', () => {
  it('generates keys correctly', () => {
    const { result } = renderHook(() => useStellarStealthKeys());

    expect(result.current.keys).toBeNull();

    act(() => {
      result.current.generate(new Uint8Array([1, 2, 3]));
    });

    expect(result.current.keys).toEqual({ viewPrivateKey: 'vpk', spendPrivateKey: 'spk' });
    expect(deriveStealthKeys).toHaveBeenCalled();
  });

  it('generates keys from a signer', async () => {
    const { result } = renderHook(() => useStellarStealthKeys());
    const signer = { signMessage: vi.fn(() => Promise.resolve(new Uint8Array(64))) };

    await act(async () => {
      await result.current.generateFromSigner(signer);
    });

    expect(result.current.keys).toEqual({
      viewPrivateKey: 'vpk-signer',
      spendPrivateKey: 'spk-signer',
    });
    expect(deriveStealthKeysFromSigner).toHaveBeenCalledWith(signer);
  });
});

describe('useStellarBalance', () => {
  it('fetches balance correctly', async () => {
    const { result } = renderHook(() => useStellarBalance('GDQ...'));

    expect(result.current.loading).toBe(true);
    expect(result.current.balance).toBeNull();

    // wait for effect to resolve
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.balance).toBe('10.5');
  });
});
