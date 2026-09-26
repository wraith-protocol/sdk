import { Memo, xdr } from '@stellar/stellar-sdk';

/**
 * Supported memo types for Stellar transactions.
 */
export type MemoType = 'none' | 'id' | 'text' | 'hash' | 'return';

/**
 * Typed memo value based on the memo type.
 */
export type MemoValue = string | Uint8Array | null;

/**
 * Typed memo structure.
 */
export interface TypedMemo {
  /** The memo type. */
  type: MemoType;
  /** The memo value (null for 'none' type). */
  value: MemoValue;
}

/**
 * Error thrown when memo validation fails.
 */
export class MemoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoValidationError';
  }
}

/**
 * Maximum byte length for text memos.
 */
export const TEXT_MEMO_MAX_BYTES = 28;

/**
 * Required byte length for hash and return memos.
 */
export const HASH_MEMO_BYTES = 32;

/**
 * Maximum value for ID memos (uint64).
 */
export const ID_MEMO_MAX = BigInt('18446744073709551615'); // 2^64 - 1

/**
 * Validates and normalizes a string value from a memo value.
 */
function normalizeStringValue(value: MemoValue, typeName: string): string {
  if (value === null || value === undefined) {
    throw new MemoValidationError(`${typeName} memo requires a value`);
  }
  return typeof value === 'string' ? value : new TextDecoder().decode(value);
}

/**
 * Validates and normalizes a buffer value from a memo value.
 */
function normalizeBufferValue(value: MemoValue, typeName: string): Uint8Array {
  if (value === null || value === undefined) {
    throw new MemoValidationError(`${typeName} memo requires a value`);
  }
  return typeof value === 'string' ? Buffer.from(value, 'hex') : Buffer.from(value);
}

/**
 * Validates an ID memo value as a uint64.
 */
function validateIdMemoValue(value: string): void {
  try {
    const num = BigInt(value);
    if (num < 0 || num > ID_MEMO_MAX) {
      throw new MemoValidationError(
        `ID memo value must be a uint64 (0 to ${ID_MEMO_MAX.toString()}), got ${value}`,
      );
    }
  } catch (e) {
    if (e instanceof MemoValidationError) throw e;
    throw new MemoValidationError(`ID memo value must be a valid uint64 string, got ${value}`);
  }
}

/**
 * Validates a text memo byte length.
 */
function validateTextMemoLength(value: string): void {
  const byteLength = new TextEncoder().encode(value).length;
  if (byteLength > TEXT_MEMO_MAX_BYTES) {
    throw new MemoValidationError(
      `Text memo must be at most ${TEXT_MEMO_MAX_BYTES} bytes, got ${byteLength} bytes`,
    );
  }
}

/**
 * Validates a hash/return memo byte length.
 */
function validateHashMemoLength(value: Uint8Array, typeName: string): void {
  if (value.length !== HASH_MEMO_BYTES) {
    throw new MemoValidationError(
      `${typeName} memo must be exactly ${HASH_MEMO_BYTES} bytes, got ${value.length} bytes`,
    );
  }
}

/**
 * Encodes a typed memo into a Stellar SDK Memo object.
 *
 * @param memo The typed memo structure.
 * @returns A Stellar SDK Memo object.
 * @throws {MemoValidationError} If the memo value is invalid for the given type.
 *
 * @example
 * ```ts
 * import { encodeMemo } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const memo = encodeMemo({ type: 'text', value: 'Payment #123' });
 * // => Memo.text('Payment #123')
 *
 * const idMemo = encodeMemo({ type: 'id', value: '12345' });
 * // => Memo.id('12345')
 *
 * const hashMemo = encodeMemo({ type: 'hash', value: Buffer.from('...') });
 * // => Memo.hash(Buffer.from('...'))
 * ```
 */
export function encodeMemo(memo: TypedMemo): Memo {
  const { type, value } = memo;

  switch (type) {
    case 'none':
      return Memo.none();

    case 'id': {
      const idValue = normalizeStringValue(value, 'ID');
      validateIdMemoValue(idValue);
      return Memo.id(idValue);
    }

    case 'text': {
      const textValue = normalizeStringValue(value, 'Text');
      validateTextMemoLength(textValue);
      return Memo.text(textValue);
    }

    case 'hash': {
      const hashValue = normalizeBufferValue(value, 'Hash');
      validateHashMemoLength(hashValue, 'Hash');
      return Memo.hash(Buffer.from(hashValue));
    }

    case 'return': {
      const returnValue = normalizeBufferValue(value, 'Return');
      validateHashMemoLength(returnValue, 'Return');
      return Memo.return(Buffer.from(returnValue).toString('hex'));
    }

    default:
      throw new MemoValidationError(`Unknown memo type: ${type as string}`);
  }
}

/**
 * Decodes a Stellar SDK Memo object into a typed structure.
 *
 * @param memo The Stellar SDK Memo object.
 * @returns A typed memo structure.
 *
 * @example
 * ```ts
 * import { decodeMemo } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const memo = Memo.text('Payment #123');
 * const typed = decodeMemo(memo);
 * // => { type: 'text', value: 'Payment #123' }
 * ```
 */
export function decodeMemo(memo: Memo | xdr.Memo): TypedMemo {
  if (memo instanceof Memo) {
    switch (memo.type) {
      case 'none':
        return { type: 'none', value: null };
      case 'id':
        return { type: 'id', value: String(memo.value) };
      case 'text':
        return { type: 'text', value: String(memo.value) };
      case 'hash':
        return { type: 'hash', value: Buffer.from(memo.value as Uint8Array) };
      case 'return':
        return { type: 'return', value: Buffer.from(memo.value as Uint8Array) };
      default:
        throw new MemoValidationError(`Unknown memo type: ${memo.type}`);
    }
  }

  // Handle xdr.Memo directly
  const xdrMemo = memo as xdr.Memo;
  const switchName = xdrMemo.switch().name;
  switch (switchName) {
    case 'memoNone':
      return { type: 'none', value: null };
    case 'memoId':
      return { type: 'id', value: String(xdrMemo.value()) };
    case 'memoText':
      return { type: 'text', value: String(xdrMemo.value()) };
    case 'memoHash':
      return { type: 'hash', value: Buffer.from(xdrMemo.value() as Uint8Array) };
    case 'memoReturn':
      return { type: 'return', value: Buffer.from(xdrMemo.value() as Uint8Array) };
    default:
      throw new MemoValidationError(`Unknown memo type: ${switchName}`);
  }
}

/**
 * Extracts the memo from a Stellar transaction and returns a typed structure.
 *
 * @param tx The Stellar transaction object.
 * @returns A typed memo structure.
 *
 * @example
 * ```ts
 * import { extractMemoFromTransaction } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const tx = new TransactionBuilder(sourceAccount, { networkPassphrase: Networks.TESTNET })
 *   .addOperation(Operation.payment({ ... }))
 *   .addMemo(Memo.text('Payment #123'))
 *   .setTimeout(30)
 *   .build();
 *
 * const memo = extractMemoFromTransaction(tx);
 * // => { type: 'text', value: 'Payment #123' }
 * ```
 */
export function extractMemoFromTransaction(tx: { memo: Memo | xdr.Memo }): TypedMemo {
  return decodeMemo(tx.memo);
}
