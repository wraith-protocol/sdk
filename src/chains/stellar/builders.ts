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
 * Describes the trustline state of a Stellar account for a specific asset,
 * and the ordered list of operations needed to make it receivable.
 */
export interface AssetReceivabilityResult {
  /**
   * Whether the account already has a trustline for the asset.
   * `false` means a `changeTrust` operation must be submitted first.
   */
  hasTrustline: boolean;
  /**
   * Whether the asset issuer has `AUTH_REQUIRED` set, meaning the issuer
   * must explicitly authorise the trustline before any balance can be received.
   */
  issuerAuthRequired: boolean;
  /**
   * Ordered list of Stellar operations the stealth account must submit to
   * become ready to receive the asset.
   *
   * - Empty when `hasTrustline` is `true` and `issuerAuthRequired` is `false`.
   * - Contains a single `changeTrust` operation when a trustline is missing
   *   and the issuer does not require auth.
   * - Contains a `changeTrust` when auth is required; the caller must also
   *   arrange issuer authorisation before a payment can be received.
   */
  ops: ReturnType<typeof Operation.changeTrust>[];
}

/**
 * Inspects a stealth account's trustline state for a given asset and returns
 * the operations needed to make it receivable.
 *
 * Pass the returned `ops` to `buildWithdrawCustomAsset` (or any other
 * transaction builder) so the stealth account can receive issued-asset payments.
 *
 * @param accountBalances - The `balances` array from a Horizon account record.
 * @param issuerFlags - The `flags` object from the issuer's Horizon account record.
 * @param asset - The Stellar asset to check.
 * @returns Trustline state and any operations needed.
 *
 * @example
 * ```ts
 * import { Server } from '@stellar/stellar-sdk/rpc';
 * import { Horizon } from '@stellar/stellar-sdk';
 *
 * const horizonServer = new Horizon.Server('https://horizon-testnet.stellar.org');
 * const stealthAccount = await horizonServer.loadAccount(stealthAddress);
 * const issuerAccount  = await horizonServer.loadAccount(asset.getIssuer());
 *
 * const result = prepareStealthAccountForAsset(
 *   stealthAccount.balances,
 *   issuerAccount.flags,
 *   asset,
 * );
 *
 * if (result.issuerAuthRequired) {
 *   console.warn('Issuer requires explicit trustline authorisation');
 * }
 * // Submit ops before expecting to receive the asset
 * ```
 */
export function prepareStealthAccountForAsset(
  accountBalances: Array<{ asset_code?: string; asset_issuer?: string; asset_type: string }>,
  issuerFlags: { auth_required?: boolean },
  asset: Asset,
): AssetReceivabilityResult {
  const hasTrustline =
    asset.isNative() ||
    accountBalances.some(
      (b) => b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer(),
    );

  const issuerAuthRequired = !asset.isNative() && !!issuerFlags.auth_required;

  const ops: ReturnType<typeof Operation.changeTrust>[] = [];
  if (!asset.isNative() && !hasTrustline) {
    ops.push(Operation.changeTrust({ asset }));
  }

  return { hasTrustline, issuerAuthRequired, ops };
}

/**
 * Options for {@link buildWithdrawCustomAsset}.
 */
export interface BuildWithdrawCustomAssetOptions {
  /** The public key (G...) of the stealth account claiming the asset. */
  stealthAddress: string;
  /** The current sequence number of the stealth account. */
  sequence: string;
  /**
   * The claimable balance ID created by the sender (hex string, e.g.
   * `"00000000..."`).
   */
  balanceId: string;
  /** The asset being claimed; used to build a trustline op when required. */
  asset: Asset;
  /**
   * Whether a `changeTrust` operation must be prepended before the claim.
   * Pass `!result.hasTrustline` from {@link prepareStealthAccountForAsset}.
   * Defaults to `false`.
   */
  needsTrustline?: boolean;
  /** The network passphrase. */
  networkPassphrase: string;
  /** The base fee in stroops. Defaults to `"100"`. */
  fee?: string;
}

/**
 * Builds a transaction for the stealth account to claim a custom-asset
 * claimable balance created by the sender.
 *
 * When `needsTrustline` is `true` the transaction prepends a `changeTrust`
 * operation so both ops execute atomically — the trustline is established and
 * the balance is claimed in a single submission.
 *
 * @param options See {@link BuildWithdrawCustomAssetOptions}.
 * @returns The unsigned transaction.
 *
 * @example
 * ```ts
 * import { buildWithdrawCustomAsset, prepareStealthAccountForAsset }
 *   from '@wraith-protocol/sdk/chains/stellar';
 *
 * const readiness = prepareStealthAccountForAsset(
 *   stealthAccount.balances,
 *   issuerAccount.flags,
 *   usdcAsset,
 * );
 *
 * const tx = buildWithdrawCustomAsset({
 *   stealthAddress: match.stealthAddress,
 *   sequence:       stealthAccount.sequence,
 *   balanceId,
 *   asset:          usdcAsset,
 *   needsTrustline: !readiness.hasTrustline,
 *   networkPassphrase: Networks.TESTNET,
 * });
 *
 * const sig = signStellarTransaction(tx.hash(), match.stealthPrivateScalar, match.stealthPubKeyBytes);
 * tx.addDecoratedSignature(...);
 * await server.submitTransaction(tx);
 * ```
 */
export function buildWithdrawCustomAsset(options: BuildWithdrawCustomAssetOptions) {
  const {
    stealthAddress,
    sequence,
    balanceId,
    asset,
    needsTrustline = false,
    networkPassphrase,
    fee = '100',
  } = options;

  const source = new Account(stealthAddress, sequence);
  const builder = new TransactionBuilder(source, { fee, networkPassphrase }).setTimeout(180);

  if (needsTrustline) {
    builder.addOperation(Operation.changeTrust({ asset }));
  }

  builder.addOperation(Operation.claimClaimableBalance({ balanceId }));

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
