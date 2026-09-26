import { describe, it, expect } from 'vitest';
import { Asset, Operation, TransactionBuilder, Account, Keypair } from '@stellar/stellar-sdk';
import {
  buildStealthPayment,
  buildStealthAnnouncement,
  prepareStealthAccountForAsset,
  buildWithdrawCustomAsset,
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

const ISSUER = Keypair.random().publicKey();
const USDC = new Asset('USDC', ISSUER);
const NETWORK = 'Test SDF Network ; September 2015';

// Minimal Horizon balance shapes
const balanceWithTrustline = [
  { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: ISSUER },
];
const balanceWithoutTrustline = [{ asset_type: 'native' }];

describe('prepareStealthAccountForAsset', () => {
  it('native XLM: hasTrustline=true, no ops', () => {
    const r = prepareStealthAccountForAsset([], {}, Asset.native());
    expect(r.hasTrustline).toBe(true);
    expect(r.issuerAuthRequired).toBe(false);
    expect(r.ops).toHaveLength(0);
  });

  it('custom asset with existing trustline: hasTrustline=true, no ops', () => {
    const r = prepareStealthAccountForAsset(balanceWithTrustline, {}, USDC);
    expect(r.hasTrustline).toBe(true);
    expect(r.issuerAuthRequired).toBe(false);
    expect(r.ops).toHaveLength(0);
  });

  it('custom asset without trustline: hasTrustline=false, changeTrust op', () => {
    const r = prepareStealthAccountForAsset(balanceWithoutTrustline, {}, USDC);
    expect(r.hasTrustline).toBe(false);
    expect(r.issuerAuthRequired).toBe(false);
    expect(r.ops).toHaveLength(1);
    // Ops are raw XDR; verify decoded type by adding to a tx
    const src = new Account(Keypair.random().publicKey(), '0');
    const tx = new TransactionBuilder(src, { fee: '100', networkPassphrase: NETWORK })
      .setTimeout(30)
      .addOperation(r.ops[0])
      .build();
    expect(tx.operations[0].type).toBe('changeTrust');
  });

  it('auth_required flag is reflected', () => {
    const r = prepareStealthAccountForAsset(balanceWithoutTrustline, { auth_required: true }, USDC);
    expect(r.issuerAuthRequired).toBe(true);
    // changeTrust op is still included so the account can submit it
    expect(r.ops).toHaveLength(1);
  });

  it('auth_required is false for native regardless of issuer flags', () => {
    const r = prepareStealthAccountForAsset([], { auth_required: true }, Asset.native());
    expect(r.issuerAuthRequired).toBe(false);
  });
});

describe('buildWithdrawCustomAsset', () => {
  const stealth = Keypair.random().publicKey();
  const balanceId = '00000000da0d57da7d4850e7fc10d2a9d0ebc731f7afdd5e6144da3ea30a332c55f0fd85';

  it('without trustline: 1 op (claimClaimableBalance)', () => {
    const tx = buildWithdrawCustomAsset({
      stealthAddress: stealth,
      sequence: '0',
      balanceId,
      asset: USDC,
      needsTrustline: false,
      networkPassphrase: NETWORK,
    });

    expect(tx.operations).toHaveLength(1);
    const op = tx.operations[0] as Operation.ClaimClaimableBalance;
    expect(op.type).toBe('claimClaimableBalance');
    expect(op.balanceId).toBe(balanceId);
  });

  it('with needsTrustline: 2 ops (changeTrust then claimClaimableBalance)', () => {
    const tx = buildWithdrawCustomAsset({
      stealthAddress: stealth,
      sequence: '0',
      balanceId,
      asset: USDC,
      needsTrustline: true,
      networkPassphrase: NETWORK,
    });

    expect(tx.operations).toHaveLength(2);
    expect(tx.operations[0].type).toBe('changeTrust');
    expect(tx.operations[1].type).toBe('claimClaimableBalance');
    const claim = tx.operations[1] as Operation.ClaimClaimableBalance;
    expect(claim.balanceId).toBe(balanceId);
  });

  it('source account is the stealth address', () => {
    const tx = buildWithdrawCustomAsset({
      stealthAddress: stealth,
      sequence: '5',
      balanceId,
      asset: USDC,
      networkPassphrase: NETWORK,
    });
    expect(tx.source).toBe(stealth);
  });
});
