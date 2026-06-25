import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Asset, Keypair, Networks, Operation } from '@stellar/stellar-sdk';
import { buildPathStealthPayment, findStrictReceivePath } from '../../../src/chains/stellar/path-payment';
import { deriveStealthKeys } from '../../../src/chains/stellar/keys';
import { encodeStealthMetaAddress } from '../../../src/chains/stellar/meta-address';

const ANNOUNCER = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
const NETWORK = Networks.TESTNET;
const USDC_ISSUER = Keypair.random().publicKey();
const USDC = new Asset('USDC', USDC_ISSUER);
const EPHEMERAL = new Uint8Array(32).fill(0xee);

// Deterministic recipient meta-address
const recipientKeys = deriveStealthKeys(new Uint8Array(64).fill(0xab));
const recipientMeta = encodeStealthMetaAddress(
  recipientKeys.spendingPubKey,
  recipientKeys.viewingPubKey,
);

const base = {
  sender: Keypair.random().publicKey(),
  sequence: '100',
  announcerContract: ANNOUNCER,
  networkPassphrase: NETWORK,
  recipientMeta,
  _ephemeralSeed: EPHEMERAL,
};

describe('buildPathStealthPayment', () => {
  describe('native XLM as receiveAsset', () => {
    it('produces 2 operations: pathPaymentStrictReceive + invokeHostFunction', () => {
      const { transaction, stealthResult } = buildPathStealthPayment({
        ...base,
        sendAsset: USDC,
        receiveAsset: Asset.native(),
        destAmount: '100',
        sendMax: '50.025',
      });

      expect(transaction.operations).toHaveLength(2);

      const swap = transaction.operations[0] as Operation.PathPaymentStrictReceive;
      expect(swap.type).toBe('pathPaymentStrictReceive');
      expect(swap.destAsset.isNative()).toBe(true);
      expect(swap.destAmount).toBe('100.0000000');
      expect(swap.sendMax).toBe('50.0250000');
      expect(swap.sendAsset.code).toBe('USDC');
      // Swap delivers directly to the stealth address
      expect(swap.destination).toBe(stealthResult.stealthAddress);

      const announce = transaction.operations[1] as Operation.InvokeHostFunction;
      expect(announce.type).toBe('invokeHostFunction');
    });

    it('stealthAddress is a valid Stellar G... address', () => {
      const { stealthResult } = buildPathStealthPayment({
        ...base,
        sendAsset: USDC,
        receiveAsset: Asset.native(),
        destAmount: '50',
        sendMax: '25',
      });
      expect(stealthResult.stealthAddress).toMatch(/^G[A-Z2-7]{55}$/);
    });

    it('is deterministic with _ephemeralSeed', () => {
      const opts = {
        ...base,
        sendAsset: USDC,
        receiveAsset: Asset.native(),
        destAmount: '10',
        sendMax: '5',
      };
      const a = buildPathStealthPayment(opts);
      const b = buildPathStealthPayment(opts);
      expect(a.stealthResult.stealthAddress).toBe(b.stealthResult.stealthAddress);
    });
  });

  describe('non-native receiveAsset (USDC)', () => {
    it('produces 3 operations: pathPayment + claimableBalance + invokeHostFunction', () => {
      const USDC2_ISSUER = Keypair.random().publicKey();
      const USDC2 = new Asset('USDC', USDC2_ISSUER);

      const { transaction, stealthResult } = buildPathStealthPayment({
        ...base,
        sendAsset: Asset.native(),
        receiveAsset: USDC2,
        destAmount: '200',
        sendMax: '100.5',
      });

      expect(transaction.operations).toHaveLength(3);

      const swap = transaction.operations[0] as Operation.PathPaymentStrictReceive;
      expect(swap.type).toBe('pathPaymentStrictReceive');
      // Swap delivers to sender, not stealth address
      expect(swap.destination).toBe(base.sender);
      expect(swap.destAmount).toBe('200.0000000');
      expect(swap.sendMax).toBe('100.5000000');

      const claimable = transaction.operations[1] as Operation.CreateClaimableBalance;
      expect(claimable.type).toBe('createClaimableBalance');
      expect(claimable.amount).toBe('200.0000000');
      expect(claimable.asset.code).toBe('USDC');
      expect(claimable.claimants[0].destination).toBe(stealthResult.stealthAddress);

      const announce = transaction.operations[2] as Operation.InvokeHostFunction;
      expect(announce.type).toBe('invokeHostFunction');
    });
  });

  describe('slippage — sendMax enforcement', () => {
    it('encodes sendMax exactly in the operation', () => {
      const { transaction } = buildPathStealthPayment({
        ...base,
        sendAsset: USDC,
        receiveAsset: Asset.native(),
        destAmount: '100',
        sendMax: '50.075', // 0.15% slippage tolerance
      });
      const swap = transaction.operations[0] as Operation.PathPaymentStrictReceive;
      expect(swap.sendMax).toBe('50.0750000');
    });

    it('accepts explicit intermediate path', () => {
      const { transaction } = buildPathStealthPayment({
        ...base,
        sendAsset: USDC,
        receiveAsset: Asset.native(),
        destAmount: '100',
        sendMax: '50',
        path: [Asset.native()],
      });
      const swap = transaction.operations[0] as Operation.PathPaymentStrictReceive;
      expect(swap.path).toHaveLength(1);
    });
  });

  describe('announcement', () => {
    it('always includes an invokeHostFunction operation as the last operation', () => {
      for (const receiveAsset of [Asset.native(), USDC]) {
        const { transaction } = buildPathStealthPayment({
          ...base,
          sendAsset: Asset.native(),
          receiveAsset,
          destAmount: '10',
          sendMax: '10',
        });
        const last = transaction.operations[transaction.operations.length - 1];
        expect(last.type).toBe('invokeHostFunction');
      }
    });
  });
});

describe('findStrictReceivePath', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('queries Horizon /paths/strict-receive endpoint', async () => {
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          source_amount: '50.0',
          source_asset: 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          destination_amount: '100.0',
          destination_asset: 'native',
          path: [],
        },
      ],
    });

    const result = await findStrictReceivePath({
      sendAsset: USDC,
      receiveAsset: Asset.native(),
      destAmount: '100',
    });

    expect(result.sourceAmount).toBe('50.0');
    expect(result.path).toEqual([]);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/paths/strict-receive?'),
    );
  });

  it('parses path with intermediate assets', async () => {
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          source_amount: '50.0',
          source_asset: 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          destination_amount: '100.0',
          destination_asset: 'native',
          path: [
            { asset_type: 'credit_alphanum4', asset_code: 'USDT', asset_issuer: 'G...' },
          ],
        },
      ],
    });

    const result = await findStrictReceivePath({
      sendAsset: USDC,
      receiveAsset: Asset.native(),
      destAmount: '100',
    });

    expect(result.path).toHaveLength(1);
    expect(result.path[0].code).toBe('USDT');
  });

  it('throws when Horizon returns error', async () => {
    const mockFetch = vi.fn();
    global.fetch = mockFetch;

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(
      findStrictReceivePath({
        sendAsset: USDC,
        receiveAsset: Asset.native(),
        destAmount: '100',
      }),
    ).rejects.toThrow('Horizon path finding failed');
  });

  it('throws when no path found', async () => {
    const mockFetch = vi.fn();
    global.fetch = mockFetch;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await expect(
      findStrictReceivePath({
        sendAsset: USDC,
        receiveAsset: Asset.native(),
        destAmount: '100',
      }),
    ).rejects.toThrow('No payment path found');
  });

  it('uses custom horizonUrl when provided', async () => {
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          source_amount: '50.0',
          source_asset: 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          destination_amount: '100.0',
          destination_asset: 'native',
          path: [],
        },
      ],
    });

    await findStrictReceivePath({
      sendAsset: USDC,
      receiveAsset: Asset.native(),
      destAmount: '100',
      horizonUrl: 'https://custom-horizon.example.com',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://custom-horizon.example.com'),
    );
  });
});
