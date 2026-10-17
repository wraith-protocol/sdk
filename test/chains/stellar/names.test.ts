import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSimulateTransaction } = vi.hoisted(() => ({
  mockSimulateTransaction: vi.fn(),
}));

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  class Server {
    async simulateTransaction(tx: { toXDR(): string }) {
      tx.toXDR();
      return mockSimulateTransaction(tx);
    }
  }
  return { ...actual, rpc: { ...actual.rpc, Server } };
});

import { rpc, xdr } from '@stellar/stellar-sdk';
import {
  ContractRevertError,
  InvalidMetaAddressError,
  InvalidNameError,
  NameNotFoundError,
  RPCAbortedError,
  RPCRequestError,
  WalletWrongNetworkError,
} from '../../../src/errors';
import { deriveStealthKeys } from '../../../src/chains/stellar/keys';
import { encodeStealthMetaAddress } from '../../../src/chains/stellar/meta-address';
import {
  DEFAULT_STELLAR_NAME_TTL_MS,
  clearStellarNameCache,
  getStellarNameDefaultTtl,
  normalizeStellarName,
  resolveStellarName,
  setStellarNameDefaultTtl,
} from '../../../src/chains/stellar/names';

const simulated = (value: xdr.ScVal) =>
  rpc.parseRawSimulation({
    id: '1',
    latestLedger: 100,
    minResourceFee: '100',
    results: [{ auth: [], xdr: value.toXDR('base64') }],
  });

const keys = deriveStealthKeys(new Uint8Array(64).fill(7));
const validMetaBytes = new Uint8Array(64);
validMetaBytes.set(keys.spendingPubKey, 0);
validMetaBytes.set(keys.viewingPubKey, 32);
const validMetaAddress = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);

describe('Stellar Wraith Names Resolver', () => {
  beforeEach(() => {
    clearStellarNameCache();
    setStellarNameDefaultTtl(DEFAULT_STELLAR_NAME_TTL_MS);
    mockSimulateTransaction.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('normalizeStellarName', () => {
    it('normalizes root names and single-level subdomains', () => {
      expect(normalizeStellarName('alice')).toBe('alice');
      expect(normalizeStellarName('alice.wraith')).toBe('alice');
      expect(normalizeStellarName('pay.alice.wraith')).toBe('pay.alice');
      expect(normalizeStellarName('bob123.wraith')).toBe('bob123');
    });

    it('rejects malformed names with InvalidNameError', () => {
      expect(() => normalizeStellarName('')).toThrow(InvalidNameError);
      expect(() => normalizeStellarName('.wraith')).toThrow(InvalidNameError);
      expect(() => normalizeStellarName('ab.wraith')).toThrow(InvalidNameError);
      expect(() => normalizeStellarName(`${'a'.repeat(33)}.wraith`)).toThrow(InvalidNameError);
      expect(() => normalizeStellarName('Alice.wraith')).toThrow(InvalidNameError);
      expect(() => normalizeStellarName('alice_bob.wraith')).toThrow(InvalidNameError);
      expect(() => normalizeStellarName('a.b.alice.wraith')).toThrow(InvalidNameError);
      expect(() => normalizeStellarName('ab.alice.wraith')).toThrow(InvalidNameError);
    });
  });

  describe('found', () => {
    it('resolves a 64-byte contract payload into an st:xlm: stealth meta-address and caches it', async () => {
      mockSimulateTransaction.mockResolvedValueOnce(
        simulated(xdr.ScVal.scvBytes(Buffer.from(validMetaBytes))),
      );

      const first = await resolveStellarName('alice.wraith', 'testnet');
      const second = await resolveStellarName('alice', 'stellar');

      expect(first).toBe(validMetaAddress);
      expect(second).toBe(validMetaAddress);
      expect(mockSimulateTransaction).toHaveBeenCalledTimes(1);
    });

    it('resolves an ASCII st:xlm: string payload returned by the contract', async () => {
      mockSimulateTransaction.mockResolvedValueOnce(
        simulated(xdr.ScVal.scvString(validMetaAddress)),
      );

      const resolved = await resolveStellarName('pay.alice.wraith', 'testnet');
      expect(resolved).toBe(validMetaAddress);
    });

    it('respects bypassCache and TTL expiration', async () => {
      vi.useFakeTimers();
      mockSimulateTransaction.mockResolvedValue(
        simulated(xdr.ScVal.scvBytes(Buffer.from(validMetaBytes))),
      );

      await resolveStellarName('alice.wraith', 'testnet', { ttlMs: 1_000 });
      await resolveStellarName('alice.wraith', 'testnet');
      expect(mockSimulateTransaction).toHaveBeenCalledTimes(1);

      await resolveStellarName('alice.wraith', 'testnet', { bypassCache: true, ttlMs: 1_000 });
      expect(mockSimulateTransaction).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(1_500);
      await resolveStellarName('alice.wraith', 'testnet');
      expect(mockSimulateTransaction).toHaveBeenCalledTimes(3);
    });
  });

  describe('missing', () => {
    it('returns null without caching when the contract reports NameNotFound (#6)', async () => {
      mockSimulateTransaction
        .mockResolvedValueOnce({ error: 'HostError: Error(Contract, #6)' })
        .mockResolvedValueOnce(simulated(xdr.ScVal.scvBytes(Buffer.from(validMetaBytes))));

      const missing = await resolveStellarName('unregistered.wraith', 'testnet');
      expect(missing).toBeNull();

      const afterRegister = await resolveStellarName('unregistered.wraith', 'testnet');
      expect(afterRegister).toBe(validMetaAddress);
      expect(mockSimulateTransaction).toHaveBeenCalledTimes(2);
    });

    it('throws NameNotFoundError when throwOnNotFound is true', async () => {
      mockSimulateTransaction.mockResolvedValueOnce({
        error: 'HostError: Error(Contract, #6)',
      });

      await expect(
        resolveStellarName('missing.wraith', 'testnet', { throwOnNotFound: true }),
      ).rejects.toBeInstanceOf(NameNotFoundError);
    });

    it('handles scvVoid and scvError(#6) return values as missing', async () => {
      mockSimulateTransaction.mockResolvedValueOnce(simulated(xdr.ScVal.scvVoid()));
      await expect(resolveStellarName('voidname.wraith', 'testnet')).resolves.toBeNull();

      mockSimulateTransaction.mockResolvedValueOnce(
        simulated(xdr.ScVal.scvError(xdr.ScError.sceContract(6))),
      );
      await expect(resolveStellarName('err6name.wraith', 'testnet')).resolves.toBeNull();
    });
  });

  describe('malformed', () => {
    it('rejects malformed input names before hitting Soroban RPC', async () => {
      await expect(resolveStellarName('BAD_NAME!', 'testnet')).rejects.toBeInstanceOf(
        InvalidNameError,
      );
      expect(mockSimulateTransaction).not.toHaveBeenCalled();
    });

    it('rejects malformed contract byte lengths and invalid curve points with InvalidMetaAddressError', async () => {
      mockSimulateTransaction.mockResolvedValueOnce(
        simulated(xdr.ScVal.scvBytes(Buffer.alloc(31, 1))),
      );
      await expect(resolveStellarName('alice.wraith', 'testnet')).rejects.toBeInstanceOf(
        InvalidMetaAddressError,
      );

      mockSimulateTransaction.mockResolvedValueOnce(simulated(xdr.ScVal.scvU32(42)));
      await expect(resolveStellarName('alice.wraith', 'testnet')).rejects.toBeInstanceOf(
        InvalidMetaAddressError,
      );

      mockSimulateTransaction.mockResolvedValueOnce({});
      await expect(resolveStellarName('alice.wraith', 'testnet')).rejects.toBeInstanceOf(
        InvalidMetaAddressError,
      );
    });
  });

  describe('wrong-network', () => {
    it('rejects unconfigured networks and passphrase mismatches with WalletWrongNetworkError', async () => {
      await expect(resolveStellarName('alice.wraith', 'mainnet')).rejects.toBeInstanceOf(
        WalletWrongNetworkError,
      );
      await expect(
        resolveStellarName('alice.wraith', 'testnet', {
          networkPassphrase: 'Public Global Stellar Network ; September 2015',
        }),
      ).rejects.toBeInstanceOf(WalletWrongNetworkError);
      expect(mockSimulateTransaction).not.toHaveBeenCalled();
    });

    it('maps RPC network passphrase mismatch errors onto WalletWrongNetworkError', async () => {
      mockSimulateTransaction.mockResolvedValueOnce({
        error: 'Transaction network passphrase mismatch',
      });
      await expect(resolveStellarName('alice.wraith', 'testnet')).rejects.toBeInstanceOf(
        WalletWrongNetworkError,
      );
    });
  });

  describe('aborted', () => {
    it('rejects immediately with RPCAbortedError when signal is already aborted', async () => {
      const controller = new AbortController();
      const reason = new Error('user cancelled');
      controller.abort(reason);

      await expect(
        resolveStellarName('alice.wraith', 'testnet', { signal: controller.signal }),
      ).rejects.toMatchObject({
        name: 'RPCAbortedError',
        code: 'WRAITH/NETWORK/RPC_ABORTED',
        cause: reason,
      });
      expect(mockSimulateTransaction).not.toHaveBeenCalled();
    });

    it('rejects in-flight simulation with RPCAbortedError when signal aborts mid-request', async () => {
      const controller = new AbortController();
      mockSimulateTransaction.mockImplementationOnce(
        () =>
          new Promise(() => {
            // Never settles; abort signal cancels it.
          }),
      );

      const pending = resolveStellarName('alice.wraith', 'testnet', {
        signal: controller.signal,
      });
      controller.abort('timeout');

      await expect(pending).rejects.toBeInstanceOf(RPCAbortedError);
    });
  });

  describe('contract reverts and transport errors', () => {
    it('maps unexpected contract error codes and transport errors to typed WraithError classes', async () => {
      mockSimulateTransaction.mockResolvedValueOnce({
        error: 'HostError: Error(Contract, #7)',
      });
      await expect(resolveStellarName('alice.wraith', 'testnet')).rejects.toBeInstanceOf(
        ContractRevertError,
      );

      mockSimulateTransaction.mockRejectedValueOnce(new Error('ECONNRESET'));
      await expect(resolveStellarName('alice.wraith', 'testnet')).rejects.toBeInstanceOf(
        RPCRequestError,
      );
    });

    it('validates setStellarNameDefaultTtl bounds', () => {
      setStellarNameDefaultTtl(10_000);
      expect(getStellarNameDefaultTtl()).toBe(10_000);
      expect(() => setStellarNameDefaultTtl(-1)).toThrow(RangeError);
    });
  });
});
