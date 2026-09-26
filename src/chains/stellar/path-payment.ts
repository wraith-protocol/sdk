import {
  Asset,
  Operation,
  TransactionBuilder,
  Account,
  Contract,
  Address,
  Claimant,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import { SCHEME_ID } from './constants';
import { generateStealthAddress } from './stealth';
import { decodeStealthMetaAddress } from './meta-address';
import { getDeployment } from './deployments';
import type { GeneratedStealthAddress } from './types';

/**
 * Options for {@link buildPathStealthPayment}.
 */
export interface BuildPathStealthPaymentOptions {
  /** The public key (G...) of the sender. */
  sender: string;
  /** The current sequence number of the sender account. */
  sequence: string;
  /** The asset the sender is spending. */
  sendAsset: Asset;
  /** The asset the stealth address should receive. */
  receiveAsset: Asset;
  /**
   * Encoded stealth meta-address of the recipient (`st:xlm:...`).
   * The helper decodes it and generates a one-time stealth address internally.
   */
  recipientMeta: string;
  /**
   * Maximum amount of `sendAsset` the sender is willing to spend.
   * Acts as slippage protection: the transaction fails if the swap would cost
   * more than this.
   */
  sendMax: string;
  /**
   * Exact amount of `receiveAsset` the stealth address should receive (as a string,
   * e.g., `"100.0"`). This is the `destAmount` of `pathPaymentStrictReceive`.
   */
  destAmount: string;
  /** Stellar network passphrase. */
  networkPassphrase: string;
  /** Address of the Wraith announcer contract. */
  announcerContract: string;
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
 * Result returned by {@link buildPathStealthPayment}.
 */
export interface PathStealthPaymentResult {
  /**
   * The combined Stellar transaction containing:
   *   1. `pathPaymentStrictReceive` — AMM swap sending `receiveAsset` to the stealth address.
   *   2. `createClaimableBalance` — wraps the received amount for non-native receiveAsset
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
 * 1. **Swaps** `sendAsset` for `receiveAsset` using `pathPaymentStrictReceive`, with
 *    `sendMax` as the slippage ceiling.
 * 2. **Delivers** `receiveAsset` to a freshly generated stealth address derived from
 *    the recipient's meta-address.
 * 3. **Announces** the stealth payment by calling the Wraith announcer contract.
 *
 * The three operations share a single envelope, so all succeed or all fail.
 *
 * ### Slippage protection
 *
 * `sendMax` caps how much `sendAsset` the sender will spend. If the AMM path
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
 * - **Native XLM as `receiveAsset`**: `pathPaymentStrictReceive` delivers XLM directly
 *   to `stealthAddress`. If the account does not exist it is created atomically.
 * - **Non-native `receiveAsset`** (e.g., USDC, yXLM): the swap delivers to the sender,
 *   who then wraps the amount in a `createClaimableBalance` claimable by the
 *   stealth address. This bypasses the trustline requirement on a brand-new account.
 *
 * @param options See {@link BuildPathStealthPaymentOptions}.
 * @returns The unsigned transaction and the generated stealth account details.
 *
 * @example
 * ```ts
 * import { Asset } from '@stellar/stellar-sdk';
 * import { buildPathStealthPayment } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const USDC_TESTNET = new Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
 *
 * const { transaction, stealthResult } = buildPathStealthPayment({
 *   sender:              senderKeypair.publicKey(),
 *   sequence:            account.sequence,
 *   sendAsset:           USDC_TESTNET,
 *   receiveAsset:        Asset.native(),
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
export function buildPathStealthPayment(
  options: BuildPathStealthPaymentOptions,
): PathStealthPaymentResult {
  const {
    sender,
    sequence,
    sendAsset,
    receiveAsset,
    recipientMeta,
    sendMax,
    destAmount,
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

  if (receiveAsset.isNative()) {
    // Swap + direct delivery to stealth account in one operation.
    // pathPaymentStrictReceive creates the destination account if it doesn't exist
    // when the dest asset is native XLM.
    builder.addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset,
        sendMax,
        destination: stealthResult.stealthAddress,
        destAsset: receiveAsset,
        destAmount,
        path,
      }),
    );
  } else {
    // Non-native receiveAsset: swap to sender first, then wrap in a claimable balance
    // so the stealth account doesn't need a pre-existing trustline.
    builder.addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset,
        sendMax,
        destination: sender,
        destAsset: receiveAsset,
        destAmount,
        path,
      }),
    );
    builder.addOperation(
      Operation.createClaimableBalance({
        asset: receiveAsset,
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

/**
 * Horizon strict-receive path response.
 */
interface HorizonStrictReceivePath {
  source_amount: string;
  source_asset: string;
  destination_amount: string;
  destination_asset: string;
  path: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string }>;
}

/**
 * Options for {@link findStrictReceivePath}.
 */
export interface FindStrictReceivePathOptions {
  /** The asset the sender is spending. */
  sendAsset: Asset;
  /** The asset the stealth address should receive. */
  receiveAsset: Asset;
  /** Exact amount of `receiveAsset` the stealth address should receive. */
  destAmount: string;
  /** Horizon API URL. Defaults to the configured deployment's Horizon URL. */
  horizonUrl?: string;
  /** Chain deployment key (e.g., "stellar"). Defaults to "stellar". */
  chain?: string;
}

/**
 * Result returned by {@link findStrictReceivePath}.
 */
export interface StrictReceivePathResult {
  /** The source amount needed to receive `destAmount`. */
  sourceAmount: string;
  /** The path of intermediate assets for the swap. */
  path: Asset[];
}

/**
 * Queries the Horizon `/paths/strict-receive` endpoint to find the best payment path.
 *
 * This helper is used before building a stealth payment to determine the optimal
 * swap route and calculate the required `sendMax` with slippage protection.
 *
 * @param options See {@link FindStrictReceivePathOptions}.
 * @returns The source amount and path for the optimal swap route.
 * @throws {Error} If the Horizon request fails or returns an invalid response.
 *
 * @example
 * ```ts
 * import { Asset } from '@stellar/stellar-sdk';
 * import { findStrictReceivePath, buildPathStealthPayment } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const USDC = new Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
 *
 * // Find the best path and quoted cost
 * const { sourceAmount, path } = await findStrictReceivePath({
 *   sendAsset: USDC,
 *   receiveAsset: Asset.native(),
 *   destAmount: '100',
 * });
 *
 * // Add slippage protection (0.5%)
 * const slippageBps = 50;
 * const sendMax = (parseFloat(sourceAmount) * (1 + slippageBps / 10_000)).toFixed(7);
 *
 * // Build the transaction with the found path
 * const { transaction } = buildPathStealthPayment({
 *   sender: 'G...',
 *   sequence: '123',
 *   sendAsset: USDC,
 *   receiveAsset: Asset.native(),
 *   destAmount: '100',
 *   sendMax,
 *   recipientMeta: 'st:xlm:...',
 *   announcerContract: 'CCJLJ...',
 *   networkPassphrase: Networks.TESTNET,
 *   path,
 * });
 * ```
 */
export async function findStrictReceivePath(
  options: FindStrictReceivePathOptions,
): Promise<StrictReceivePathResult> {
  const { sendAsset, receiveAsset, destAmount, horizonUrl, chain = 'stellar' } = options;

  const deployment = getDeployment(chain);
  const url = horizonUrl || deployment.horizonUrl;

  // Build Horizon asset strings
  const sendAssetStr = sendAsset.isNative() ? 'native' : `${sendAsset.code}:${sendAsset.issuer}`;
  const receiveAssetStr = receiveAsset.isNative()
    ? 'native'
    : `${receiveAsset.code}:${receiveAsset.issuer}`;

  const params = new URLSearchParams({
    source_account: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWH4', // Dummy account for path finding
    destination_asset: receiveAssetStr,
    destination_amount: destAmount,
    source_assets: sendAssetStr,
  });

  const response = await fetch(`${url}/paths/strict-receive?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Horizon path finding failed: ${response.status} ${response.statusText}`);
  }

  const data: HorizonStrictReceivePath[] = await response.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('No payment path found for the given assets and amount');
  }

  // Use the first (best) path
  const bestPath = data[0];

  // Parse the path assets
  const pathAssets: Asset[] = bestPath.path.map((p) => {
    if (p.asset_type === 'native') {
      return Asset.native();
    }
    if (p.asset_code && p.asset_issuer) {
      return new Asset(p.asset_code, p.asset_issuer);
    }
    throw new Error(`Invalid path asset: ${JSON.stringify(p)}`);
  });

  return {
    sourceAmount: bestPath.source_amount,
    path: pathAssets,
  };
}
