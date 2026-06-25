import { describe, it, expect } from 'vitest';
import { Asset, Operation, TransactionBuilder, Keypair } from '@stellar/stellar-sdk';
import {
  buildStealthPayment,
  buildStealthAnnouncement,
} from '../../../src/chains/stellar/builders';

describe('Stellar Builders', () => {
  const sender = Keypair.random().publicKey();
  const sequence = '12345';
  const networkPassphrase = 'Test SDF Network ; September 2015';
  const stealthResult = {
    stealthAddress: Keypair.random().publicKey(),
    ephemeralPubKey: new Uint8Array(32).fill(1),
    viewTag: 42,
  };

  describe('buildStealthPayment', () => {
    it('builds a native payment if stealth exists', () => {
      const tx = buildStealthPayment({
        sender,
        sequence,
        stealthResult,
        amount: '100',
        networkPassphrase,
        stealthExists: true,
      });

      expect(tx.operations.length).toBe(1);
      const op = tx.operations[0] as Operation.Payment;
      expect(op.type).toBe('payment');
      expect(op.destination).toBe(stealthResult.stealthAddress);
      expect(op.amount).toBe('100.0000000');
      expect(op.asset.isNative()).toBe(true);
    });

    it('builds a createAccount if stealth does not exist (native)', () => {
      const tx = buildStealthPayment({
        sender,
        sequence,
        stealthResult,
        amount: '100',
        networkPassphrase,
        stealthExists: false,
      });

      expect(tx.operations.length).toBe(1);
      const op = tx.operations[0] as Operation.CreateAccount;
      expect(op.type).toBe('createAccount');
      expect(op.destination).toBe(stealthResult.stealthAddress);
      expect(op.startingBalance).toBe('100.0000000');
    });

    it('builds a createClaimableBalance for custom assets', () => {
      const issuer = Keypair.random().publicKey();
      const customAsset = new Asset('USDC', issuer);
      const tx = buildStealthPayment({
        sender,
        sequence,
        stealthResult,
        amount: '50',
        asset: customAsset,
        networkPassphrase,
      });

      expect(tx.operations.length).toBe(1);
      const op = tx.operations[0] as Operation.CreateClaimableBalance;
      expect(op.type).toBe('createClaimableBalance');
      expect(op.amount).toBe('50.0000000');
      expect(op.asset.code).toBe('USDC');
      expect(op.claimants[0].destination).toBe(stealthResult.stealthAddress);
    });
  });

  describe('buildStealthAnnouncement', () => {
    it('builds a contract call for announcement', () => {
      const announcerContract = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
      const tx = buildStealthAnnouncement({
        sender,
        sequence,
        stealthResult,
        announcerContract,
        networkPassphrase,
      });

      expect(tx.operations.length).toBe(1);
      const op = tx.operations[0] as Operation.InvokeHostFunction;
      expect(op.type).toBe('invokeHostFunction');
    });
  });
});
