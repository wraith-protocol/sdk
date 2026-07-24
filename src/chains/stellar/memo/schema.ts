/**
 * Structured memo schema for Wraith Stellar memos.
 *
 * The schema encodes a { version, kind, data } triplet into exactly 32 bytes,
 * fitting Stellar MEMO_HASH and MEMO_RETURN constraints.
 *
 * # Binary Layout (32 bytes)
 * ```
 * [0]     version      uint8   – must be 0x01 for v1
 * [1]     kind         uint8   – MemoKind enum value
 * [2]     data_length  uint8   – number of meaningful bytes in data (0–29)
 * [3..31] data         bytes   – payload, zero-padded
 * ```
 *
 * # Backwards Compatibility
 * If the first byte is NOT `0x01`, the buffer is treated as raw bytes and
 * returned as a `raw` result.  This ensures existing hash/return memos that
 * happen not to carry the version marker decode gracefully instead of failing.
 *
 * # Extension Mechanism
 * New kinds are added by extending the {@link MemoKind} enum with a new
 * numeric value and updating the encoder/decoder if special handling is needed.
 * The `decodeMemoSchema` function already forwards any kind value in the
 * parsed result, so consumers can interpret custom kinds without changes
 * to this module.
 *
 * Kind value ranges:
 * - `0x01–0xEF` – Reserved for standardised kinds (add via PR).
 * - `0xF0–0xFF` – Reserved for private / experimental use (no coordination needed).
 *
 * @module
 */

/** Current schema version identifier. */
export const MEMO_SCHEMA_VERSION = 0x01;

/** Total byte length of a schema-encoded memo (matches MEMO_HASH / MEMO_RETURN). */
export const SCHEMA_MEMO_BYTES = 32;

/** Number of header bytes (version + kind + data_length). */
export const SCHEMA_HEADER_BYTES = 3;

/** Maximum number of payload bytes that fit in one schema memo. */
export const SCHEMA_MAX_DATA_BYTES = SCHEMA_MEMO_BYTES - SCHEMA_HEADER_BYTES; // 29

/**
 * Well-known memo kinds.
 *
 * Each variant carries a short description of the intended semantics and the
 * expected data encoding so consumers know how to interpret the payload.
 *
 * | Value | Name        | Data encoding         | Description                         |
 * |-------|-------------|-----------------------|-------------------------------------|
 * | 0x01  | `Reason`    | UTF-8 string          | Human-readable reason / note         |
 * | 0x02  | `InvoiceId` | UTF-8 string          | Invoice or reference identifier     |
 * | 0x03  | `Reference` | Arbitrary bytes       | Opaque reference payload            |
 */
export enum MemoKind {
  Reason = 0x01,
  InvoiceId = 0x02,
  Reference = 0x03,
}

/**
 * Parsed v1 memo schema.
 */
export interface MemoSchemaV1 {
  version: typeof MEMO_SCHEMA_VERSION;
  kind: MemoKind;
  data: Uint8Array;
}

/**
 * Decode result for a 32-byte memo buffer.
 *
 * If the buffer is schema-shaped (first byte equals {@link MEMO_SCHEMA_VERSION}),
 * the `schema` field is populated.  Otherwise the buffer is treated as raw bytes
 * for backwards compatibility.
 */
export interface DecodedMemoSchema {
  /** The original 32-byte buffer. */
  bytes: Uint8Array;
  /** Parsed schema when the buffer is schema-shaped; `undefined` for raw memos. */
  schema?: MemoSchemaV1;
}

/**
 * Returns `true` when the 32-byte buffer carries a recognised schema version marker.
 */
function isSchemaShaped(bytes: Uint8Array): boolean {
  return bytes.length === SCHEMA_MEMO_BYTES && bytes[0] === MEMO_SCHEMA_VERSION;
}

/**
 * Encodes a structured memo schema into a 32-byte buffer suitable for
 * MEMO_HASH or MEMO_RETURN.
 *
 * @param kind  - The {@link MemoKind} to encode.
 * @param data  - Payload data.  Strings are encoded as UTF-8.
 * @returns A 32-byte Uint8Array.
 *
 * @throws {Error} If the encoded data exceeds {@link SCHEMA_MAX_DATA_BYTES} (29 bytes).
 *
 * @example
 * ```ts
 * // Encode a reason string
 * const bytes = encodeMemoSchema(MemoKind.Reason, 'Payment for order #123');
 *
 * // Encode arbitrary reference bytes
 * const ref = encodeMemoSchema(MemoKind.Reference, new Uint8Array([0x01, 0x02, 0x03]));
 * ```
 */
export function encodeMemoSchema(kind: MemoKind, data: Uint8Array | string): Uint8Array {
  const dataBytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;

  if (dataBytes.length > SCHEMA_MAX_DATA_BYTES) {
    throw new Error(
      `Memo schema data exceeds maximum of ${SCHEMA_MAX_DATA_BYTES} bytes (got ${dataBytes.length})`,
    );
  }

  const buffer = new Uint8Array(SCHEMA_MEMO_BYTES);
  buffer[0] = MEMO_SCHEMA_VERSION;
  buffer[1] = kind;
  buffer[2] = dataBytes.length;
  buffer.set(dataBytes, SCHEMA_HEADER_BYTES);
  // Remaining bytes are already zero-filled by the Uint8Array constructor

  return buffer;
}

/**
 * Decodes a 32-byte memo buffer into a {@link DecodedMemoSchema}.
 *
 * **Backwards compatibility**: buffers whose first byte is not the schema
 * version marker are returned as `{ bytes, schema: undefined }` so callers
 * can fall back to treating the content as opaque raw bytes.
 *
 * @param bytes - A 32-byte buffer (typically from MEMO_HASH or MEMO_RETURN).
 * @returns The decoded result with optional schema.
 *
 * @example
 * ```ts
 * const memo = decodeMemoSchema(memoBytes);
 *
 * if (memo.schema) {
 *   // Structured — inspect memo.schema.kind / memo.schema.data
 *   console.log('Kind:', memo.schema.kind);
 *   console.log('Data hex:', bytesToHex(memo.schema.data));
 * } else {
 *   // Raw bytes — handle as before
 *   console.log('Raw hex:', bytesToHex(memo.bytes));
 * }
 * ```
 */
export function decodeMemoSchema(bytes: Uint8Array): DecodedMemoSchema {
  const result: DecodedMemoSchema = { bytes };

  if (isSchemaShaped(bytes)) {
    const kind = bytes[1] as MemoKind;
    const dataLength = Math.min(bytes[2], SCHEMA_MAX_DATA_BYTES);
    const data = bytes.slice(SCHEMA_HEADER_BYTES, SCHEMA_HEADER_BYTES + dataLength);

    result.schema = {
      version: MEMO_SCHEMA_VERSION,
      kind,
      data,
    };
  }

  return result;
}
