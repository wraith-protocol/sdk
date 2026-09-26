import { describe, it, expect } from 'vitest';
import { Asset, Keypair, Networks, Operation } from '@stellar/stellar-sdk';
import { buildStellarSwapAndStealth } from '../../../src/chains/stellar/swap';
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

describe('buildStellarSwapAndStealth', () => {
  describe('native XLM as toAsset', () => {
    it('produces 2 operations: pathPaymentStrictReceive + invokeHostFunction', () => {
      const { transaction, stealthResult } = buildStellarSwapAndStealth({
        ...base,
        fromAsset: USDC,
        toAsset: Asset.native(),
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
      const { stealthResult } = buildStellarSwapAndStealth({
        ...base,
        fromAsset: USDC,
        toAsset: Asset.native(),
        destAmount: '50',
        sendMax: '25',
      });
      expect(stealthResult.stealthAddress).toMatch(/^G[A-Z2-7]{55}$/);
    });

    it('is deterministic with _ephemeralSeed', () => {
      const opts = {
        ...base,
        fromAsset: USDC,
        toAsset: Asset.native(),
        destAmount: '10',
        sendMax: '5',
      };
      const a = buildStellarSwapAndStealth(opts);
      const b = buildStellarSwapAndStealth(opts);
      expect(a.stealthResult.stealthAddress).toBe(b.stealthResult.stealthAddress);
    });
  });

  describe('non-native toAsset (USDC)', () => {
    it('produces 3 operations: pathPayment + claimableBalance + invokeHostFunction', () => {
      const USDC2_ISSUER = Keypair.random().publicKey();
      const USDC2 = new Asset('USDC', USDC2_ISSUER);

      const { transaction, stealthResult } = buildStellarSwapAndStealth({
        ...base,
        fromAsset: Asset.native(),
        toAsset: USDC2,
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
      const { transaction } = buildStellarSwapAndStealth({
        ...base,
        fromAsset: USDC,
        toAsset: Asset.native(),
        destAmount: '100',
        sendMax: '50.075', // 0.15% slippage tolerance
      });
      const swap = transaction.operations[0] as Operation.PathPaymentStrictReceive;
      expect(swap.sendMax).toBe('50.0750000');
    });

    it('accepts explicit intermediate path', () => {
      const { transaction } = buildStellarSwapAndStealth({
        ...base,
        fromAsset: USDC,
        toAsset: Asset.native(),
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
      for (const toAsset of [Asset.native(), USDC]) {
        const { transaction } = buildStellarSwapAndStealth({
          ...base,
          fromAsset: Asset.native(),
          toAsset,
          destAmount: '10',
          sendMax: '10',
        });
        const last = transaction.operations[transaction.operations.length - 1];
        expect(last.type).toBe('invokeHostFunction');
      }
    });
  });
});
