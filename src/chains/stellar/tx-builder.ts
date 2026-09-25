import { decodeStealthMetaAddress } from './meta-address';
import { generateStealthAddress } from './stealth';
import { bytesToHex } from './utils';
import { SCHEME_ID } from './constants';
import type {
  GeneratedStealthAddress,
  StealthPayment,
  BuildBatchSendTxParams,
  BuildBatchSendTxResult,
} from './types';

/**
 * Stellar operation count limit.
 * The Stellar protocol limits transactions to 100 operations.
 */
export const STELLAR_MAX_OPERATIONS = 100;

/**
 * Default base fee per operation in stroops.
 */
export const DEFAULT_BASE_FEE = 100;

/**
 * Default threshold for using stealth-batch-sender contract.
 */
export const DEFAULT_BATCH_SENDER_THRESHOLD = 10;

/**
 * Builds a Stellar transaction that sends XLM to multiple stealth addresses.
 *
 * This function:
 * - Generates stealth addresses for each recipient
 * - Builds a transaction with payment operations
 * - Scales fees based on operation count
 * - Validates against operation count limits
 * - Optionally uses stealth-batch-sender contract for large batches
 *
 * @param params Batch send transaction parameters
 * @returns Built transaction ready for signing
 * @throws Error if payment count exceeds max operations
 */
export function buildBatchSendTx(params: BuildBatchSendTxParams): BuildBatchSendTxResult {
  const {
    payments,
    sourceAccount,
    memo,
    networkPassphrase,
    baseFee = DEFAULT_BASE_FEE,
    maxOperations = STELLAR_MAX_OPERATIONS,
    batchSenderThreshold = DEFAULT_BATCH_SENDER_THRESHOLD,
    batchSenderContract,
  } = params;

  // Validate payment count
  if (payments.length === 0) {
    throw new Error('Payments array cannot be empty');
  }

  if (payments.length > maxOperations) {
    throw new Error(
      `Payment count (${payments.length}) exceeds maximum operations per transaction (${maxOperations})`,
    );
  }

  // Generate stealth addresses for all payments
  const stealthAddresses: GeneratedStealthAddress[] = payments.map((payment) => {
    const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(payment.metaAddress);
    return generateStealthAddress(spendingPubKey, viewingPubKey);
  });

  // Determine if we should use stealth-batch-sender contract
  const useBatchSender =
    batchSenderContract !== undefined && payments.length >= batchSenderThreshold;

  // Load Stellar SDK dynamically (peer dependency)
  const {
    TransactionBuilder,
    Operation,
    Memo,
    Asset,
    Contract,
    Address,
    StrKey,
    nativeToScVal,
    xdr,
  } = require('@stellar/stellar-sdk');

  // Calculate total fee with scaling
  // Fee scales with operation count to ensure timely inclusion
  const operationCount = useBatchSender ? 1 : payments.length;
  const totalFee = operationCount * baseFee;

  // Start building the transaction
  let builder = new TransactionBuilder(sourceAccount, {
    fee: totalFee.toString(),
    networkPassphrase,
  });

  // Add memo if provided
  if (memo) {
    if (memo.length <= 28) {
      builder = builder.addMemo(Memo.text(memo));
    } else if (memo.length <= 64) {
      builder = builder.addMemo(Memo.hash(memo));
    } else {
      throw new Error('Memo too long: max 28 characters for text, 64 for hash');
    }
  }

  if (useBatchSender && batchSenderContract) {
    if (!StrKey.isValidContract(batchSenderContract)) {
      throw new Error(`Invalid batchSenderContract: expected a Soroban contract address`);
    }

    const accountId = sourceAccount.accountId();
    const assets = payments.map((payment) => resolvePaymentAsset({ Asset, StrKey }, payment));
    const firstAsset = assets[0];
    if (
      assets.some(
        (asset: any) =>
          asset.contractId(networkPassphrase) !== firstAsset.contractId(networkPassphrase),
      )
    ) {
      throw new Error('Batch sender payments must all use the same asset');
    }

    const tokenContract = firstAsset.contractId(networkPassphrase);
    const contract = new Contract(batchSenderContract);
    const addresses = xdr.ScVal.scvVec(
      stealthAddresses.map((stealth: GeneratedStealthAddress) =>
        new Address(stealth.stealthAddress).toScVal(),
      ),
    );
    const ephemeralKeys = xdr.ScVal.scvVec(
      stealthAddresses.map((stealth: GeneratedStealthAddress) =>
        xdr.ScVal.scvBytes(Buffer.from(stealth.ephemeralPubKey)),
      ),
    );
    const metadatas = xdr.ScVal.scvVec(
      stealthAddresses.map((stealth: GeneratedStealthAddress) =>
        xdr.ScVal.scvBytes(Buffer.from([stealth.viewTag])),
      ),
    );
    const amounts = xdr.ScVal.scvVec(
      payments.map((payment: { amount: string }) =>
        nativeToScVal(toStroops(payment.amount), { type: 'i128' }),
      ),
    );

    builder = builder.addOperation(
      contract.call(
        'batch_send',
        new Address(accountId).toScVal(),
        new Address(tokenContract).toScVal(),
        nativeToScVal(SCHEME_ID, { type: 'u32' }),
        addresses,
        ephemeralKeys,
        metadatas,
        amounts,
      ),
    );
  } else {
    // Build individual payment operations
    for (let i = 0; i < payments.length; i++) {
      const payment = payments[i];
      const stealth = stealthAddresses[i];

      builder = builder.addOperation(
        Operation.payment({
          destination: stealth.stealthAddress,
          asset: resolvePaymentAsset({ Asset, StrKey }, payment),
          amount: payment.amount,
        }),
      );
    }
  }

  // Set timeout (30 seconds default)
  builder = builder.setTimeout(30);

  // Build the transaction
  const transaction = builder.build();

  return {
    transaction,
    stealthAddresses,
    totalFee,
    usedBatchSender: useBatchSender,
  };
}

function resolvePaymentAsset(
  sdk: { Asset: any; StrKey: any },
  payment: { asset?: string; assetIssuer?: string },
): any {
  const { Asset, StrKey } = sdk;
  const asset = payment.asset;
  if (!asset || asset === 'native' || asset === 'XLM') return Asset.native();
  if (!payment.assetIssuer || !StrKey.isValidEd25519PublicKey(payment.assetIssuer)) {
    throw new Error(`assetIssuer is required and must be a valid account for asset "${asset}"`);
  }
  return new Asset(asset, payment.assetIssuer);
}

function toStroops(amount: string): bigint {
  if (!/^\d+(?:\.\d{1,7})?$/.test(amount) || amount === '0') {
    throw new Error(`Invalid payment amount: ${amount}`);
  }
  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, '0'));
}

/**
 * Builds announcement data for stealth payments.
 * This can be used to publish announcements after sending payments.
 *
 * @param stealthAddresses Generated stealth addresses
 * @param caller Sender's Stellar public key
 * @returns Array of announcement objects ready for the announcer contract
 */
export function buildAnnouncementData(
  stealthAddresses: GeneratedStealthAddress[],
  caller: string,
): Array<{
  schemeId: number;
  stealthAddress: string;
  caller: string;
  ephemeralPubKey: string;
  metadata: string;
}> {
  return stealthAddresses.map((stealth) => ({
    schemeId: SCHEME_ID,
    stealthAddress: stealth.stealthAddress,
    caller,
    ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
    metadata: stealth.viewTag.toString(16).padStart(2, '0'),
  }));
}
