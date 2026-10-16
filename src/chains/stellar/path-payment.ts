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
import { AttemptDeadline, resolveTimeouts } from './timeouts';
import { HorizonResponseError, RPCRequestError } from '../../errors';

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

/** Largest `/paths/strict-receive` response body accepted, in bytes (after decompression). */
const MAX_PATH_RESPONSE_BYTES = 256 * 1024;
/** How much of an error response body is read for the `RPCRequestError` message, in bytes. */
const MAX_ERROR_BODY_BYTES = 2 * 1024;
/** Most path records accepted from one response. Horizon does not paginate this endpoint. */
const MAX_PATH_RECORDS = 100;
/** Most intermediate assets a path payment can hop through (`Asset path<5>` in the XDR). */
const MAX_PATH_HOPS = 5;
/** A positive Stellar amount: at most 7 decimals and within int64 stroops. */
const AMOUNT_RE = /^\d{1,12}(\.\d{1,7})?$/;
const MAX_STROOPS = 9_223_372_036_854_775_807n;

/**
 * Parses a classic Stellar amount (int64 stroops, as Horizon reports it) into stroops, or returns
 * `null` if it is not a valid positive one. Unlike the i128 contract amounts in `tx-builder.ts`,
 * these are bounded by int64.
 */
function toStroops(amount: unknown): bigint | null {
  if (typeof amount !== 'string' || !AMOUNT_RE.test(amount)) return null;
  const [whole, fraction = ''] = amount.split('.');
  const stroops = BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, '0'));
  return stroops > 0n && stroops <= MAX_STROOPS ? stroops : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Short, single-line rendering of an untrusted value for error messages. */
function show(value: unknown): string {
  return String(JSON.stringify(value)).slice(0, 80);
}

/**
 * Reads at most `limit` bytes of a response body and cancels the rest, so an untrusted server
 * cannot make the caller buffer an unbounded body. `truncated` is true when the body was longer.
 */
async function readCapped(
  response: Response,
  limit: number,
): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    // No body stream (some fetch polyfills): the body is already buffered, so only the limit
    // itself can still be enforced, in bytes like the streaming path.
    const text = await response.text();
    const truncated = new TextEncoder().encode(text).byteLength > limit;
    return { text: truncated ? text.slice(0, limit) : text, truncated };
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > limit) {
      chunks.push(value.subarray(0, limit - size));
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), truncated };
}

/**
 * Builds an {@link Asset} from Horizon's `asset_type` / `asset_code` / `asset_issuer` triple,
 * throwing {@link HorizonResponseError} unless the three fields describe one valid asset.
 */
function parseHorizonAsset(
  type: unknown,
  code: unknown,
  issuer: unknown,
  url: string,
  field: string,
): Asset {
  if (type === 'native' && code === undefined && issuer === undefined) {
    return Asset.native();
  }
  if (typeof code === 'string' && typeof issuer === 'string') {
    try {
      const asset = new Asset(code, issuer);
      // The Asset constructor accepts any 1–12 character code, so also check the declared type.
      if (asset.getAssetType() === type) return asset;
    } catch {
      // Reported below.
    }
  }
  throw new HorizonResponseError(
    url,
    field,
    `not a valid asset (type ${show(type)}, code ${show(code)}, issuer ${show(issuer)})`,
  );
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
 * Horizon returns every path it found in one `_embedded.records` page; this endpoint is not
 * paginated. Each record is validated (amounts, assets, path shape, and that it is a path from
 * `sendAsset` to exactly `destAmount` of `receiveAsset`), and the one with the smallest
 * `source_amount` is returned.
 *
 * @param options See {@link FindStrictReceivePathOptions}.
 * @returns The source amount and path for the cheapest swap route.
 * @throws {RPCRequestError} If Horizon answers with a non-2xx status.
 * @throws {HorizonResponseError} If the response is oversized, is not valid JSON, or a record
 * fails validation.
 * @throws {Error} If Horizon finds no path for the given assets and amount.
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

  const wantedStroops = toStroops(destAmount);
  if (wantedStroops === null) {
    throw new Error(
      `destAmount must be a positive Stellar amount with at most 7 decimals, got ${show(destAmount)}`,
    );
  }

  const deployment = getDeployment(chain);
  const baseUrl = (horizonUrl || deployment.horizonUrl).replace(/\/+$/, '');

  // Horizon takes either `source_account` or `source_assets`, never both, and describes the
  // destination asset as separate type / code / issuer parameters.
  const params = new URLSearchParams({
    source_assets: sendAsset.isNative() ? 'native' : `${sendAsset.code}:${sendAsset.issuer}`,
    destination_asset_type: receiveAsset.getAssetType(),
    destination_amount: destAmount,
  });
  if (!receiveAsset.isNative()) {
    params.set('destination_asset_code', receiveAsset.code);
    params.set('destination_asset_issuer', receiveAsset.issuer);
  }
  const url = `${baseUrl}/paths/strict-receive?${params.toString()}`;

  const invalid = (field: string, reason: string) => new HorizonResponseError(url, field, reason);

  // Same connect / request timeouts as the SDK's Horizon client, so a server that never answers
  // or trickles the body cannot hang the call.
  const deadline = new AttemptDeadline(resolveTimeouts(), { url, endpoint: baseUrl, attempt: 1 });
  let body: string;
  try {
    const response = await deadline.send(fetch, url, {});
    if (!response.ok) {
      // The status is what matters; a body that fails to arrive must not hide it.
      const { text } = await deadline
        .read(readCapped(response, MAX_ERROR_BODY_BYTES))
        .catch(() => ({ text: '' }));
      throw new RPCRequestError(url, response.status, text.slice(0, 500));
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (declaredLength > MAX_PATH_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw invalid('body', `${declaredLength} bytes exceeds the ${MAX_PATH_RESPONSE_BYTES} limit`);
    }
    const read = await deadline.read(readCapped(response, MAX_PATH_RESPONSE_BYTES));
    if (read.truncated) {
      throw invalid('body', `longer than the ${MAX_PATH_RESPONSE_BYTES} byte limit`);
    }
    body = read.text;
  } finally {
    deadline.dispose();
  }

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw invalid('body', 'not valid JSON');
  }

  const records = isRecord(data) && isRecord(data._embedded) ? data._embedded.records : undefined;
  if (!Array.isArray(records)) {
    throw invalid('_embedded.records', 'missing or not an array');
  }
  if (records.length > MAX_PATH_RECORDS) {
    throw invalid(
      '_embedded.records',
      `${records.length} records exceeds the ${MAX_PATH_RECORDS} limit`,
    );
  }
  let best: { stroops: bigint; sourceAmount: string; path: Asset[] } | undefined;

  for (const [i, record] of records.entries()) {
    const at = `_embedded.records[${i}]`;
    if (!isRecord(record)) {
      throw invalid(at, 'not an object');
    }

    const source = parseHorizonAsset(
      record.source_asset_type,
      record.source_asset_code,
      record.source_asset_issuer,
      url,
      `${at}.source_asset`,
    );
    if (!source.equals(sendAsset)) {
      throw invalid(`${at}.source_asset`, 'does not match the requested sendAsset');
    }
    const destination = parseHorizonAsset(
      record.destination_asset_type,
      record.destination_asset_code,
      record.destination_asset_issuer,
      url,
      `${at}.destination_asset`,
    );
    if (!destination.equals(receiveAsset)) {
      throw invalid(`${at}.destination_asset`, 'does not match the requested receiveAsset');
    }

    const stroops = toStroops(record.source_amount);
    if (stroops === null) {
      throw invalid(
        `${at}.source_amount`,
        `not a positive Stellar amount: ${show(record.source_amount)}`,
      );
    }
    const destStroops = toStroops(record.destination_amount);
    if (destStroops !== wantedStroops) {
      throw invalid(
        `${at}.destination_amount`,
        `${show(record.destination_amount)} is not the requested ${show(destAmount)}`,
      );
    }

    if (!Array.isArray(record.path) || record.path.length > MAX_PATH_HOPS) {
      throw invalid(`${at}.path`, `must be an array of at most ${MAX_PATH_HOPS} assets`);
    }
    const path = record.path.map((hop: unknown, j) => {
      const hopAt = `${at}.path[${j}]`;
      if (!isRecord(hop)) throw invalid(hopAt, 'not an object');
      return parseHorizonAsset(hop.asset_type, hop.asset_code, hop.asset_issuer, url, hopAt);
    });

    if (!best || stroops < best.stroops) {
      best = { stroops, sourceAmount: record.source_amount as string, path };
    }
  }

  if (!best) {
    throw new Error('No payment path found for the given assets and amount');
  }
  return { sourceAmount: best.sourceAmount, path: best.path };
}
