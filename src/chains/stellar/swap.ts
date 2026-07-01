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
import { generateStealthAddress } from './stealth';
import { decodeStealthMetaAddress } from './meta-address';
import type { GeneratedStealthAddress } from './types';

/**
 * Options for {@link buildStellarSwapAndStealth}.
 */
export interface BuildStellarSwapAndStealthOptions {
  /** The public key (G...) of the sender. */
  sender: string;
  /** The current sequence number of the sender account. */
  sequence: string;
  /** The asset the sender is spending (e.g., USDC). */
  fromAsset: Asset;
  /** The asset the stealth address receives (e.g., native XLM). */
  toAsset: Asset;
  /**
   * Exact amount of `toAsset` the stealth address should receive (as a string,
   * e.g., `"100.0"`). This is the `destAmount` of `pathPaymentStrictReceive`.
   */
  destAmount: string;
  /**
   * Maximum amount of `fromAsset` the sender is willing to spend.
   * Acts as slippage protection: the transaction fails if the swap would cost
   * more than this. Defaults to `destAmount` when `fromAsset === toAsset`.
   */
  sendMax: string;
  /**
   * Encoded stealth meta-address of the recipient (`st:xlm:...`).
   * The helper decodes it and generates a one-time stealth address internally.
   */
  recipientMeta: string;
  /** Address of the Wraith announcer contract. */
  announcerContract: string;
  /** Stellar network passphrase. */
  networkPassphrase: string;
  /**
   * Intermediate assets for the AMM path. Leave empty or undefined to let
   * Stellar path-finding pick the best route (order book fallback applies).
   * Pass an explicit path to pin the route, e.g., `[Asset.native()]` for
   * USDC → XLM via the native asset.
   */
  path?: Asset[];
  /** Base fee in stroops. Defaults to `"100"`. */
  fee?: string;
  /**
   * Optional fixed 32-byte ephemeral seed for deterministic tests.
   * Never pass this in production.
   */
  _ephemeralSeed?: Uint8Array;
}

/**
 * Result returned by {@link buildStellarSwapAndStealth}.
 */
export interface SwapAndStealthResult {
  /**
   * The combined Stellar transaction containing:
   *   1. `pathPaymentStrictReceive` — AMM swap sending `toAsset` to the stealth address.
   *   2. `createClaimableBalance` — wraps the received amount for non-native toAsset
   *      so the stealth account can claim without a pre-existing trustline, **or**
   *      the swap operation itself already delivers native XLM directly.
   *   3. `invokeHostFunction` — announces the stealth payment on the Wraith contract.
   *
   * Sign and submit this transaction. Both legs succeed or fail atomically.
   */
  transaction: ReturnType<TransactionBuilder['build']>;
  /** The generated one-time stealth account. */
  stealthResult: GeneratedStealthAddress;
}

/**
 * Builds a single atomic Stellar transaction that:
 *
 * 1. **Swaps** `fromAsset` for `toAsset` using `pathPaymentStrictReceive`, with
 *    `sendMax` as the slippage ceiling.
 * 2. **Delivers** `toAsset` to a freshly generated stealth address derived from
 *    the recipient's meta-address.
 * 3. **Announces** the stealth payment by calling the Wraith announcer contract.
 *
 * The three operations share a single envelope, so all succeed or all fail.
 *
 * ### Slippage protection
 *
 * `sendMax` caps how much `fromAsset` the sender will spend. If the AMM path
 * costs more, Stellar rejects the transaction with `PATH_PAYMENT_TOO_FEW_OFFERS`
 * or an under-funded error before any funds move.
 *
 * To express a percentage slippage tolerance given a quoted send cost:
 * ```ts
 * const quotedSend = "50.0";   // obtained from Horizon /paths
 * const slippageBps = 50;      // 0.5 %
 * const sendMax = (parseFloat(quotedSend) * (1 + slippageBps / 10_000)).toFixed(7);
 * ```
 *
 * ### Asset delivery
 *
 * - **Native XLM as `toAsset`**: `pathPaymentStrictReceive` delivers XLM directly
 *   to `stealthAddress`. If the account does not exist it is created atomically.
 * - **Non-native `toAsset`** (e.g., USDC, yXLM): the swap delivers to the sender,
 *   who then wraps the amount in a `createClaimableBalance` claimable by the
 *   stealth address. This bypasses the trustline requirement on a brand-new account.
 *
 * @param options See {@link BuildStellarSwapAndStealthOptions}.
 * @returns The unsigned transaction and the generated stealth account details.
 *
 * @example
 * ```ts
 * import { Asset } from '@stellar/stellar-sdk';
 * import { buildStellarSwapAndStealth } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const USDC_TESTNET = new Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
 *
 * const { transaction, stealthResult } = buildStellarSwapAndStealth({
 *   sender:              senderKeypair.publicKey(),
 *   sequence:            account.sequence,
 *   fromAsset:           USDC_TESTNET,
 *   toAsset:             Asset.native(),
 *   destAmount:          '100',       // receive exactly 100 XLM
 *   sendMax:             '50.025',    // spend at most 50.025 USDC (0.05 % slippage)
 *   recipientMeta:       'st:xlm:...', // recipient's published meta-address
 *   announcerContract:   'CCJLJ...',
 *   networkPassphrase:   Networks.TESTNET,
 * });
 *
 * transaction.sign(senderKeypair);
 * await server.submitTransaction(transaction);
 * ```
 */
export function buildStellarSwapAndStealth(
  options: BuildStellarSwapAndStealthOptions,
): SwapAndStealthResult {
  const {
    sender,
    sequence,
    fromAsset,
    toAsset,
    destAmount,
    sendMax,
    recipientMeta,
    announcerContract,
    networkPassphrase,
    path = [],
    fee = '100',
    _ephemeralSeed,
  } = options;

  const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(recipientMeta);
  const stealthResult = generateStealthAddress(spendingPubKey, viewingPubKey, _ephemeralSeed);

  const source = new Account(sender, sequence);
  const builder = new TransactionBuilder(source, { fee, networkPassphrase }).setTimeout(180);

  if (toAsset.isNative()) {
    // Swap + direct delivery to stealth account in one operation.
    // pathPaymentStrictReceive creates the destination account if it doesn't exist
    // when the dest asset is native XLM.
    builder.addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset: fromAsset,
        sendMax,
        destination: stealthResult.stealthAddress,
        destAsset: toAsset,
        destAmount,
        path,
      }),
    );
  } else {
    // Non-native toAsset: swap to sender first, then wrap in a claimable balance
    // so the stealth account doesn't need a pre-existing trustline.
    builder.addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset: fromAsset,
        sendMax,
        destination: sender,
        destAsset: toAsset,
        destAmount,
        path,
      }),
    );
    builder.addOperation(
      Operation.createClaimableBalance({
        asset: toAsset,
        amount: destAmount,
        claimants: [new Claimant(stealthResult.stealthAddress, Claimant.predicateUnconditional())],
      }),
    );
  }

  // Announce the stealth payment so the recipient can scan for it.
  const contract = new Contract(announcerContract);
  builder.addOperation(
    contract.call(
      'announce',
      nativeToScVal(SCHEME_ID, { type: 'u32' }),
      new Address(stealthResult.stealthAddress).toScVal(),
      xdr.ScVal.scvBytes(Buffer.from(stealthResult.ephemeralPubKey)),
      xdr.ScVal.scvBytes(Buffer.from([stealthResult.viewTag])),
    ),
  );

  return { transaction: builder.build(), stealthResult };
}
