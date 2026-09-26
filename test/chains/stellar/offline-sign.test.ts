import { describe, it, expect } from 'vitest';
import { Keypair, Operation, Asset, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  prepareOfflineStellarTransaction,
  signOfflineStellarTransaction,
  submitOfflineStellarTransaction,
} from '../../../src/chains/stellar/offline-sign';
import { deriveStealthKeys } from '../../../src/chains/stellar/keys';
import { generateStealthAddress } from '../../../src/chains/stellar/stealth';
import { deriveStealthPrivateScalar } from '../../../src/chains/stellar/spend';

describe('Stellar Offline Sign', () => {
  const sender = Keypair.random();
  const recipient = Keypair.random();
  const networkPassphrase = 'Test SDF Network ; September 2015';
  const sequence = '12345';

  describe('prepareOfflineStellarTransaction', () => {
    it('builds a valid envelope with transactionXdr, networkPassphrase, and hash', () => {
      const envelope = prepareOfflineStellarTransaction({
        source: sender.publicKey(),
        ops: [
          Operation.payment({
            destination: recipient.publicKey(),
            asset: Asset.native(),
            amount: '100',
          }),
        ],
        sequence,
        networkPassphrase,
      });

      expect(envelope.transactionXdr).toBeTypeOf('string');
      expect(envelope.transactionXdr.length).toBeGreaterThan(0);
      expect(envelope.networkPassphrase).toBe(networkPassphrase);
      expect(envelope.hash).toBeTypeOf('string');
      expect(envelope.hash.length).toBe(64);
    });

    it('throws if source is empty', () => {
      expect(() =>
        prepareOfflineStellarTransaction({
          source: '',
          ops: [
            Operation.payment({
              destination: recipient.publicKey(),
              asset: Asset.native(),
              amount: '1',
            }),
          ],
          sequence,
          networkPassphrase,
        }),
      ).toThrow('source must be a valid Stellar public key');
    });

    it('throws if ops is empty', () => {
      expect(() =>
        prepareOfflineStellarTransaction({
          source: sender.publicKey(),
          ops: [],
          sequence,
          networkPassphrase,
        }),
      ).toThrow('at least one operation is required');
    });

    it('throws if sequence is empty', () => {
      expect(() =>
        prepareOfflineStellarTransaction({
          source: sender.publicKey(),
          ops: [
            Operation.payment({
              destination: recipient.publicKey(),
              asset: Asset.native(),
              amount: '1',
            }),
          ],
          sequence: '',
          networkPassphrase,
        }),
      ).toThrow('sequence must be a valid sequence number string');
    });

    it('throws if networkPassphrase is empty', () => {
      expect(() =>
        prepareOfflineStellarTransaction({
          source: sender.publicKey(),
          ops: [
            Operation.payment({
              destination: recipient.publicKey(),
              asset: Asset.native(),
              amount: '1',
            }),
          ],
          sequence,
          networkPassphrase: '',
        }),
      ).toThrow('networkPassphrase is required');
    });
  });

  describe('signOfflineStellarTransaction', () => {
    it('returns a valid signed XDR string with a regular Stellar secret key', () => {
      const envelope = prepareOfflineStellarTransaction({
        source: sender.publicKey(),
        ops: [
          Operation.payment({
            destination: recipient.publicKey(),
            asset: Asset.native(),
            amount: '100',
          }),
        ],
        sequence,
        networkPassphrase,
      });

      const signedXdr = signOfflineStellarTransaction(envelope, sender.secret());

      expect(signedXdr).toBeTypeOf('string');
      expect(signedXdr.length).toBeGreaterThan(0);

      const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
      expect(tx.signatures.length).toBe(1);
    });

    it('works with a stealth-derived stealthPubKey parameter', () => {
      const signature = new Uint8Array(64);
      for (let i = 0; i < 64; i++) {
        signature[i] = i;
      }
      const stealthKeys = deriveStealthKeys(signature);

      const ephSeed = new Uint8Array(32).fill(42);
      const stealthResult = generateStealthAddress(
        stealthKeys.spendingPubKey,
        stealthKeys.viewingPubKey,
        ephSeed,
      );

      const stealthScalar = deriveStealthPrivateScalar(
        stealthKeys.spendingScalar,
        stealthKeys.viewingKey,
        new Uint8Array(stealthResult.ephemeralPubKey),
      );

      const envelope = prepareOfflineStellarTransaction({
        source: sender.publicKey(),
        ops: [
          Operation.payment({
            destination: stealthResult.stealthAddress,
            asset: Asset.native(),
            amount: '50',
          }),
        ],
        sequence,
        networkPassphrase,
      });

      const signedXdr = signOfflineStellarTransaction(
        envelope,
        stealthScalar,
        stealthKeys.spendingPubKey,
      );

      expect(signedXdr).toBeTypeOf('string');
      expect(signedXdr.length).toBeGreaterThan(0);

      const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
      expect(tx.signatures.length).toBe(1);
    });

    it('throws if stealthPubKey is missing when key is a bigint', () => {
      const envelope = prepareOfflineStellarTransaction({
        source: sender.publicKey(),
        ops: [
          Operation.payment({
            destination: recipient.publicKey(),
            asset: Asset.native(),
            amount: '10',
          }),
        ],
        sequence,
        networkPassphrase,
      });

      expect(() => signOfflineStellarTransaction(envelope, 12345n)).toThrow(
        'stealthPubKey (32 bytes) is required',
      );
    });

    it('throws for an invalid envelope', () => {
      expect(() =>
        signOfflineStellarTransaction(
          { transactionXdr: '', networkPassphrase: '', hash: '' },
          sender.secret(),
        ),
      ).toThrow('Invalid envelope');
    });
  });

  describe('submitOfflineStellarTransaction', () => {
    it('is a separate async function from signing', () => {
      expect(submitOfflineStellarTransaction).toBeTypeOf('function');
      expect(submitOfflineStellarTransaction.constructor.name).toBe('AsyncFunction');
    });
  });

  describe('end-to-end', () => {
    it('prepare offline → sign offline → verify the XDR is valid', () => {
      const envelope = prepareOfflineStellarTransaction({
        source: sender.publicKey(),
        ops: [
          Operation.payment({
            destination: recipient.publicKey(),
            asset: Asset.native(),
            amount: '100',
          }),
        ],
        sequence,
        networkPassphrase,
      });

      const signedXdr = signOfflineStellarTransaction(envelope, sender.secret());
      const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);

      expect(tx.operations.length).toBe(1);
      expect(tx.signatures.length).toBe(1);
    });
  });
});
