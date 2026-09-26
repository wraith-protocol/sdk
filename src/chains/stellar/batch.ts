import {
  TransactionBuilder,
  Account,
  Operation,
  BASE_FEE,
  Asset,
  StrKey,
} from '@stellar/stellar-sdk';
import { hexToBytes } from './utils';
import { SCHEME_ID } from './constants';

const MAX_OPS_PER_TX = 100;
const OPS_PER_PAYMENT = 2;
const MAX_PAYMENTS_PER_TX = Math.floor(MAX_OPS_PER_TX / OPS_PER_PAYMENT);

export interface StealthPaymentConfig {
  /** Stellar public key (G...) of the stealth address. */
  destination: string;
  /** Amount to send (e.g. "10.5"). */
  amount: string;
  /** Asset code ("native", "XLM", or a custom asset code). Defaults to "native". */
  asset?: string;
  /** Asset issuer G... address (required for non-native assets). */
  assetIssuer?: string;
  /** Hex-encoded 32-byte ephemeral public key. */
  ephemeralPubKey: string;
  /** View tag byte (0–255). */
  viewTag: number;
  /** Optional caller — defaults to the source account. */
  caller?: string;
}

export interface BatchConfig {
  /** Source account public key (G...). */
  source: string;
  /** Current sequence number of the source account. */
  sequence: string;
  /** Stellar network passphrase (e.g. Networks.TESTNET). */
  networkPassphrase: string;
  /** Fee per operation in stroops. Defaults to BASE_FEE (100). */
  feePerOp?: number;
  /** Timeout in seconds. Defaults to 300. */
  timeout?: number;
}

export interface BuildResult {
  /** Transaction envelope XDR (base64) strings, one per transaction. */
  transactions: string[];
  /** Number of transactions built. */
  txCount: number;
  /** Total number of stealth payments across all transactions. */
  paymentCount: number;
  /** Total fee across all transactions in stroops. */
  totalFee: number;
}

/**
 * Encodes announcement data into a compact binary format suitable for
 * storing in a Stellar manageData operation value (max 64 bytes).
 *
 * Format (34 bytes):
 *   [0]       — schemeId (1 byte)
 *   [1..32]   — ephemeral public key (32 bytes)
 *   [33]      — view tag (1 byte)
 */
export function encodeAnnouncementData(ephemeralPubKey: Uint8Array, viewTag: number): Uint8Array {
  const data = new Uint8Array(1 + 32 + 1);
  data[0] = SCHEME_ID;
  data.set(ephemeralPubKey, 1);
  data[33] = viewTag;
  return data;
}

/**
 * Decodes announcement data back into its components.
 */
export function decodeAnnouncementData(data: Uint8Array): {
  schemeId: number;
  ephemeralPubKey: Uint8Array;
  viewTag: number;
} {
  if (data.length < 34) {
    throw new Error(`Invalid announcement data length: expected 34 bytes, got ${data.length}`);
  }
  const ephPubKey = new Uint8Array(data.slice(1, 33));
  const viewTag = data[33];
  return {
    schemeId: data[0],
    ephemeralPubKey: ephPubKey,
    viewTag,
  };
}

/**
 * Builds Stellar transactions for multiple stealth payments in a batch.
 *
 * Stellar supports up to 100 operations per transaction with atomic semantics,
 * so a batch of N stealth payments produces ceil(N / 50) transactions, each
 * containing up to 50 payment+announcement pairs (100 ops).
 *
 * Usage:
 * ```ts
 * const builder = new StellarBatchBuilder({
 *   source: 'G...',
 *   sequence: '1234',
 *   networkPassphrase: Networks.TESTNET,
 * });
 *
 * builder
 *   .addPayment({
 *     destination: 'G...',
 *     amount: '10',
 *     asset: 'native',
 *     ephemeralPubKey: 'aabb...',
 *     viewTag: 42,
 *   })
 *   .addPayment({ ... });
 *
 * const result = builder.build();
 * // result.transactions — XDR base64 strings ready to sign
 * ```
 */
export class StellarBatchBuilder {
  private config: BatchConfig;
  private payments: StealthPaymentConfig[] = [];
  private _needsBuild = true;
  private _cachedResult: BuildResult | null = null;

  constructor(config: BatchConfig) {
    this.config = {
      feePerOp: Number(BASE_FEE),
      timeout: 300,
      ...config,
    };
    this.validateAddress(config.source, 'source');
  }

  /**
   * Validates a Stellar G... address.
   */
  private validateAddress(addr: string, label: string): void {
    if (!StrKey.isValidEd25519PublicKey(addr)) {
      throw new Error(`Invalid ${label} address: ${addr}`);
    }
  }

  /**
   * Validates a single payment config.
   */
  private validatePayment(payment: StealthPaymentConfig, index: number): void {
    this.validateAddress(payment.destination, `payment[${index}].destination`);

    const ephBytes = hexToBytes(payment.ephemeralPubKey);
    if (ephBytes.length !== 32) {
      throw new Error(
        `payment[${index}].ephemeralPubKey: expected 32 bytes (64 hex chars), got ${ephBytes.length} bytes`,
      );
    }

    if (payment.viewTag < 0 || payment.viewTag > 255) {
      throw new Error(`payment[${index}].viewTag: expected 0–255, got ${payment.viewTag}`);
    }

    const amount = Number(payment.amount);
    if (!isFinite(amount) || amount <= 0) {
      throw new Error(
        `payment[${index}].amount: expected positive number, got "${payment.amount}"`,
      );
    }

    if (payment.asset && payment.asset !== 'native' && payment.asset !== 'XLM') {
      if (!payment.assetIssuer) {
        throw new Error(`payment[${index}].assetIssuer is required for asset "${payment.asset}"`);
      }
      this.validateAddress(payment.assetIssuer, `payment[${index}].assetIssuer`);
    }
  }

  /**
   * Adds a stealth payment to the batch.
   *
   * Each payment produces two operations:
   * - A payment operation sending assets to the stealth address.
   * - A manageData operation storing the announcement data.
   */
  addPayment(payment: StealthPaymentConfig): this {
    this.validatePayment(payment, this.payments.length);
    this.payments.push(payment);
    this._needsBuild = true;
    return this;
  }

  /**
   * Returns the number of payments currently in the batch.
   */
  get paymentCount(): number {
    return this.payments.length;
  }

  /**
   * Returns the number of operations the batch would produce
   * (payments * 2) before splitting.
   */
  get operationCount(): number {
    return this.payments.length * OPS_PER_PAYMENT;
  }

  /**
   * Returns the number of transactions the batch will split into.
   */
  get expectedTransactionCount(): number {
    if (this.payments.length === 0) return 0;
    return Math.ceil(this.payments.length / MAX_PAYMENTS_PER_TX);
  }

  /**
   * Validates that the source account balance can cover the total fee.
   *
   * @param balanceXlm  Account XLM balance as a string (e.g. "100.5").
   * @throws If the total fee (converted to XLM) exceeds the balance.
   */
  validateBalance(balanceXlm: string): void {
    const feePerOp = this.config.feePerOp!;
    const totalOps = this.operationCount;
    const totalFeeStroops = totalOps * feePerOp;
    const totalFeeXlm = totalFeeStroops / 10_000_000;

    const balance = Number(balanceXlm);
    if (!isFinite(balance) || balance < 0) {
      throw new Error(`Invalid balance: "${balanceXlm}"`);
    }

    if (totalFeeXlm > balance) {
      throw new Error(
        `Insufficient balance: ${totalFeeXlm} XLM fee required but account has ${balanceXlm} XLM`,
      );
    }
  }

  /**
   * Builds the transaction(s) for all added payments.
   *
   * Groups payments into chunks of at most `MAX_PAYMENTS_PER_TX` (50),
   * producing one Stellar transaction per chunk. Each transaction includes
   * the payment operations followed by announcement manageData operations
   * for every recipient in the chunk.
   *
   * @returns BuildResult containing the XDR base64-encoded transactions.
   */
  build(): BuildResult {
    if (!this._needsBuild && this._cachedResult) {
      return this._cachedResult;
    }

    if (this.payments.length === 0) {
      throw new Error('No payments added to the batch');
    }

    const feePerOp = this.config.feePerOp!;
    const timeout = this.config.timeout!;
    const sourceStr = this.config.source;
    const chunks: StealthPaymentConfig[][] = [];

    for (let i = 0; i < this.payments.length; i += MAX_PAYMENTS_PER_TX) {
      chunks.push(this.payments.slice(i, i + MAX_PAYMENTS_PER_TX));
    }

    const transactions: string[] = [];
    let seqNum = BigInt(this.config.sequence);

    for (const chunk of chunks) {
      const sourceAccount = new Account(sourceStr, seqNum.toString());
      const opsCount = chunk.length * OPS_PER_PAYMENT;
      const fee = String(opsCount * feePerOp);

      const builder = new TransactionBuilder(sourceAccount, {
        fee,
        networkPassphrase: this.config.networkPassphrase,
      });

      for (let i = 0; i < chunk.length; i++) {
        const payment = chunk[i];

        const asset =
          payment.asset && payment.asset !== 'native' && payment.asset !== 'XLM'
            ? new Asset(payment.asset, payment.assetIssuer!)
            : Asset.native();

        builder.addOperation(
          Operation.payment({
            destination: payment.destination,
            asset,
            amount: payment.amount,
          }),
        );

        const ephBytes = hexToBytes(payment.ephemeralPubKey);
        const annData = encodeAnnouncementData(ephBytes, payment.viewTag);

        builder.addOperation(
          Operation.manageData({
            name: `wraith:ann:${i}`,
            value: Buffer.from(annData),
          }),
        );
      }

      builder.setTimeout(timeout);
      const tx = builder.build();
      transactions.push(tx.toEnvelope().toXDR('base64'));

      seqNum++;
    }

    const totalOps = this.payments.length * OPS_PER_PAYMENT;
    const totalFee = totalOps * feePerOp;

    this._cachedResult = {
      transactions,
      txCount: transactions.length,
      paymentCount: this.payments.length,
      totalFee,
    };
    this._needsBuild = false;

    return this._cachedResult;
  }
}
