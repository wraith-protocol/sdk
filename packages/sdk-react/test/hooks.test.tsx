// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStellarStealthKeys, useStellarBalance, useStellarName } from '../src/hooks';
import { InvalidNameError, RPCAbortedError, WalletWrongNetworkError } from '@wraith-protocol/sdk';
import {
  deriveStealthKeys,
  deriveStealthKeysFromSigner,
  resolveStellarName,
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
    resolveStellarName: vi.fn(),
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.balance).toBe('10.5');
  });
});

describe('useStellarName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stays idle when name is undefined', () => {
    const { result } = renderHook(() => useStellarName(undefined));
    expect(result.current.address).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(resolveStellarName).not.toHaveBeenCalled();
  });

  it('resolves a found name and clears loading', async () => {
    const expected = `st:xlm:${'a'.repeat(128)}`;
    vi.mocked(resolveStellarName).mockResolvedValueOnce(expected);

    const { result } = renderHook(() => useStellarName('alice.wraith', 'testnet'));
    expect(result.current.loading).toBe(true);

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.address).toBe(expected);
    expect(result.current.error).toBeNull();
  });

  it('handles missing names by setting address to null without error', async () => {
    vi.mocked(resolveStellarName).mockResolvedValueOnce(null);

    const { result } = renderHook(() => useStellarName('missing.wraith', 'testnet'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.address).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('surfaces typed InvalidNameError for malformed names', async () => {
    const malformedErr = new InvalidNameError('ab', 'Too short');
    vi.mocked(resolveStellarName).mockRejectedValueOnce(malformedErr);

    const { result } = renderHook(() => useStellarName('ab', 'testnet'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.address).toBeNull();
    expect(result.current.error).toBe(malformedErr);
  });

  it('surfaces typed WalletWrongNetworkError for wrong-network requests', async () => {
    const wrongNetErr = new WalletWrongNetworkError({
      chain: 'stellar',
      expectedNetwork: 'testnet',
      actualNetwork: 'mainnet',
    });
    vi.mocked(resolveStellarName).mockRejectedValueOnce(wrongNetErr);

    const { result } = renderHook(() => useStellarName('alice.wraith', 'mainnet'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.address).toBeNull();
    expect(result.current.error).toBe(wrongNetErr);
  });

  it('aborts in-flight requests on unmount and surfaces RPCAbortedError for caller signal aborts', async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(resolveStellarName).mockImplementationOnce((_name, _chain, opts) => {
      capturedSignal = opts?.signal;
      return new Promise(() => {});
    });

    const { unmount } = renderHook(() => useStellarName('alice.wraith', 'testnet'));
    expect(capturedSignal?.aborted).toBe(false);
    unmount();
    expect(capturedSignal?.aborted).toBe(true);

    const abortedErr = new RPCAbortedError('https://soroban-testnet.stellar.org');
    const callerController = new AbortController();
    callerController.abort();
    vi.mocked(resolveStellarName).mockRejectedValueOnce(abortedErr);

    const { result } = renderHook(() =>
      useStellarName('alice.wraith', 'testnet', { signal: callerController.signal }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(abortedErr);
  });
});
