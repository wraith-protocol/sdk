import {
  Asset,
  Operation,
  Claimant,
  TransactionBuilder,
  Account,
  Contract,
  Address,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import { SCHEME_ID } from './constants';
import { GeneratedStealthAddress } from './types';

/**
 * Options for building a Stellar stealth payment transaction.
 */
export interface BuildStealthPaymentOptions {
  /** The public key (G...) of the sender. */
  sender: string;
  /** The current sequence number of the sender account. */
  sequence: string;
  /** The generated stealth address result (address, ephemeral key, view tag). */
  stealthResult: GeneratedStealthAddress;
  /** The amount to send (as a string, e.g., "100.0"). */
  amount: string;
  /** The asset to send. Defaults to native XLM. */
  asset?: Asset;
  /** The network passphrase (e.g., Testnet or Public). */
  networkPassphrase: string;
  /** The base fee for the transaction (in stroops). Defaults to "100". */
  fee?: string;
  /** Whether the stealth account already exists (only relevant for XLM payments). */
  stealthExists?: boolean;
}

/**
 * Builds a Stellar transaction that sends funds to a stealth address.
 *
 * For native XLM:
 * - If the stealth account doesn't exist, it uses CreateAccount.
 * - If it exists, it uses Payment.
 *
 * For non-native assets (Issued Tokens):
 * - It uses CreateClaimableBalance. This allows sending assets to a stealth
 *   address even if it doesn't have a trustline yet.
 *
 * @param options Transaction building options.
 * @returns The built Transaction object.
 */
export function buildStealthPayment(options: BuildStealthPaymentOptions) {
  const {
    sender,
    sequence,
    stealthResult,
    amount,
    asset = Asset.native(),
    networkPassphrase,
    fee = '100',
    stealthExists = false,
  } = options;

  const source = new Account(sender, sequence);
  const builder = new TransactionBuilder(source, {
    fee,
    networkPassphrase,
  }).setTimeout(180);

  if (asset.isNative()) {
    if (stealthExists) {
      builder.addOperation(
        Operation.payment({
          destination: stealthResult.stealthAddress,
          asset,
          amount,
        }),
      );
    } else {
      builder.addOperation(
        Operation.createAccount({
          destination: stealthResult.stealthAddress,
          startingBalance: amount,
        }),
      );
    }
  } else {
    // For custom assets, use Claimable Balance to bypass trustline requirements
    builder.addOperation(
      Operation.createClaimableBalance({
        asset,
        amount,
        claimants: [new Claimant(stealthResult.stealthAddress, Claimant.predicateUnconditional())],
      }),
    );
  }

  return builder.build();
}

/**
 * Options for building a Soroban announcement transaction.
 */
export interface BuildAnnouncementOptions {
  /** The public key (G...) of the sender. */
  sender: string;
  /** The current sequence number of the sender account. */
  sequence: string;
  /** The generated stealth address result. */
  stealthResult: GeneratedStealthAddress;
  /** The address of the Wraith Announcer contract. */
  announcerContract: string;
  /** The network passphrase. */
  networkPassphrase: string;
  /** The base fee. Defaults to "100". */
  fee?: string;
}

/**
 * Builds a Soroban transaction that announces a stealth payment.
 *
 * This should be called alongside buildStealthPayment so that recipients
 * can detect the payment via events.
 *
 * @param options Transaction building options.
 * @returns The built Transaction object (pre-simulation).
 */
export function buildStealthAnnouncement(options: BuildAnnouncementOptions) {
  const {
    sender,
    sequence,
    stealthResult,
    announcerContract,
    networkPassphrase,
    fee = '100',
  } = options;

  const source = new Account(sender, sequence);
  const contract = new Contract(announcerContract);

  return new TransactionBuilder(source, {
    fee,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        'announce',
        nativeToScVal(SCHEME_ID, { type: 'u32' }),
        new Address(stealthResult.stealthAddress).toScVal(),
        xdr.ScVal.scvBytes(Buffer.from(stealthResult.ephemeralPubKey)),
        xdr.ScVal.scvBytes(Buffer.from([stealthResult.viewTag])),
      ),
    )
    .setTimeout(180)
    .build();
}
