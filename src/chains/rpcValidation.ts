import { RPCRequestError, RPCResponseError } from '../errors';

/**
 * Largest JSON body accepted from one chain data source, in bytes.
 *
 * EVM subgraph pages, Solana transactions and CKB indexer pages are all far
 * below this; anything larger is rejected before it is parsed or decoded.
 */
export const MAX_RPC_RESPONSE_BYTES = 1024 * 1024;

/** Largest number of records accepted from a single page or response. */
export const MAX_RPC_RECORDS = 1000;

/** Most characters accepted from a single string field (keys, hashes, cursors). */
export const MAX_RPC_STRING_CHARS = 4096;

/** Identifies the chain and operation a validation failure came from. */
export interface RPCResponseContext {
  /** Chain key used in the error, e.g. `'evm'`, `'solana'`, `'ckb'`. */
  chain: string;
  /** SDK operation reading the payload, e.g. `'fetchAnnouncements'`. */
  operation: string;
}

/**
 * Builds the SDK's typed validation error for an untrusted response.
 *
 * Reasons must describe the schema violation only (type, length, shape); never
 * pass response values into `reason`, so payloads cannot leak into logs.
 */
export function invalidResponse(
  context: RPCResponseContext,
  field: string,
  reason: string,
): RPCResponseError {
  return new RPCResponseError(context.chain, context.operation, field, reason);
}

/** Short, single-line name for an untrusted value's type. */
export function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Returns `true` for plain JSON objects (not arrays or `null`). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Requires a plain JSON object. */
export function requireRecord(
  value: unknown,
  context: RPCResponseContext,
  field: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw invalidResponse(context, field, `expected an object, got ${describeType(value)}`);
  }
  return value;
}

/** Requires a JSON array with at most `maxLength` entries. */
export function requireArray(
  value: unknown,
  context: RPCResponseContext,
  field: string,
  maxLength = MAX_RPC_RECORDS,
): unknown[] {
  if (!Array.isArray(value)) {
    throw invalidResponse(context, field, `expected an array, got ${describeType(value)}`);
  }
  if (value.length > maxLength) {
    throw invalidResponse(context, field, `has ${value.length} entries, more than ${maxLength}`);
  }
  return value;
}

/** Options for {@link requireString}. */
export interface StringOptions {
  /** Minimum accepted length after trimming is not applied; defaults to 0. */
  minLength?: number;
  /** Maximum accepted length; defaults to {@link MAX_RPC_STRING_CHARS}. */
  maxLength?: number;
  /** Optional pattern the string must match. */
  pattern?: RegExp;
  /** Human-readable description of `pattern` used in the error reason. */
  patternName?: string;
}

/** Requires a string within the configured bounds. Values are never echoed. */
export function requireString(
  value: unknown,
  context: RPCResponseContext,
  field: string,
  options: StringOptions = {},
): string {
  const maxLength = options.maxLength ?? MAX_RPC_STRING_CHARS;
  if (typeof value !== 'string') {
    throw invalidResponse(context, field, `expected a string, got ${describeType(value)}`);
  }
  if (value.length < (options.minLength ?? 0)) {
    throw invalidResponse(context, field, 'string is shorter than the minimum length');
  }
  if (value.length > maxLength) {
    throw invalidResponse(context, field, `string is longer than ${maxLength} characters`);
  }
  if (options.pattern && !options.pattern.test(value)) {
    throw invalidResponse(context, field, `must be ${options.patternName ?? 'well-formed'}`);
  }
  return value;
}

/** Options for {@link requireHex}. */
export interface HexOptions {
  /** Exact byte length required after the optional `0x` prefix. */
  bytes?: number;
  /** Maximum byte length allowed after the optional `0x` prefix. */
  maxBytes?: number;
  /** Whether `0x` alone (zero bytes) is accepted. Defaults to `false`. */
  allowEmpty?: boolean;
}

const HEX_BODY = /^[0-9a-fA-F]*$/;

/**
 * Requires a hex string, accepts both `0x`-prefixed and bare encodings, and
 * returns it lowercased with a single `0x` prefix.
 */
export function requireHex(
  value: unknown,
  context: RPCResponseContext,
  field: string,
  options: HexOptions = {},
): string {
  if (typeof value !== 'string') {
    throw invalidResponse(context, field, `expected a hex string, got ${describeType(value)}`);
  }
  const body = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value;
  if (body.length === 0 && !options.allowEmpty) {
    throw invalidResponse(context, field, 'hex string is empty');
  }
  if (body.length % 2 !== 0) {
    throw invalidResponse(context, field, 'hex string has an odd number of characters');
  }
  if (!HEX_BODY.test(body)) {
    throw invalidResponse(context, field, 'hex string contains non-hex characters');
  }
  const byteLength = body.length / 2;
  if (options.bytes !== undefined && byteLength !== options.bytes) {
    throw invalidResponse(
      context,
      field,
      `expected ${options.bytes} bytes, got ${byteLength} bytes`,
    );
  }
  if (options.maxBytes !== undefined && byteLength > options.maxBytes) {
    throw invalidResponse(
      context,
      field,
      `expected at most ${options.maxBytes} bytes, got ${byteLength} bytes`,
    );
  }
  return `0x${body.toLowerCase()}`;
}

/** Options for {@link requireBigInt}. */
export interface BigIntOptions {
  /** Inclusive minimum. */
  min?: bigint;
  /** Inclusive maximum. */
  max?: bigint;
}

const DECIMAL = /^\d+$/;
const HEX_INTEGER = /^0x[0-9a-fA-F]+$/;

/**
 * Requires a non-negative integer encoded as a JSON number, a decimal string or
 * a hex string, and returns it as a bigint. Input length is bounded before
 * `BigInt()` is called so a huge string cannot be parsed.
 */
export function requireBigInt(
  value: unknown,
  context: RPCResponseContext,
  field: string,
  options: BigIntOptions = {},
): bigint {
  let parsed: bigint;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw invalidResponse(context, field, 'expected a safe integer, got a non-integer number');
    }
    parsed = BigInt(value);
  } else if (typeof value === 'string') {
    if (value.length > 64) {
      throw invalidResponse(context, field, 'integer string is too long');
    }
    if (DECIMAL.test(value)) {
      parsed = BigInt(value);
    } else if (HEX_INTEGER.test(value)) {
      parsed = BigInt(value);
    } else {
      throw invalidResponse(context, field, 'expected a decimal or hex integer string');
    }
  } else {
    throw invalidResponse(context, field, `expected an integer, got ${describeType(value)}`);
  }
  if (options.min !== undefined && parsed < options.min) {
    throw invalidResponse(context, field, `expected a value of at least ${options.min}`);
  }
  if (options.max !== undefined && parsed > options.max) {
    throw invalidResponse(context, field, `expected a value of at most ${options.max}`);
  }
  return parsed;
}

/** Requires an integer JSON number within the configured bounds. */
export function requireInteger(
  value: unknown,
  context: RPCResponseContext,
  field: string,
  options: { min?: number; max?: number } = {},
): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw invalidResponse(
      context,
      field,
      `expected an integer, got ${typeof value === 'number' ? 'a non-integer number' : describeType(value)}`,
    );
  }
  if (options.min !== undefined && value < options.min) {
    throw invalidResponse(context, field, `expected a value of at least ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    throw invalidResponse(context, field, `expected a value of at most ${options.max}`);
  }
  return value;
}

/**
 * Reads at most `limit` bytes of a response body and cancels the rest, so an
 * untrusted server cannot make the caller buffer an unbounded body.
 */
async function readCapped(
  response: Response,
  limit: number,
): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    // Some fetch polyfills do not expose a body stream; the body is already
    // buffered, so only the limit itself can still be enforced.
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

  const bytes = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), truncated };
}

/**
 * Reads a chain data source response, rejecting non-2xx statuses, oversized or
 * truncated bodies and invalid JSON before the payload is inspected.
 *
 * @param response - The fetch response to read.
 * @param context - Chain and operation for validation errors.
 * @param url - Endpoint used in an {@link RPCRequestError} for a non-2xx status.
 * @param maxBytes - Body size limit; defaults to {@link MAX_RPC_RESPONSE_BYTES}.
 */
export async function readBoundedJson(
  response: Response,
  context: RPCResponseContext,
  url: string,
  maxBytes = MAX_RPC_RESPONSE_BYTES,
): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new RPCRequestError(url, response.status);
  }

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw invalidResponse(
      context,
      'body',
      `${declaredLength} bytes exceeds the ${maxBytes} byte limit`,
    );
  }

  const read = await readCapped(response, maxBytes);
  if (read.truncated) {
    throw invalidResponse(context, 'body', `response is longer than the ${maxBytes} byte limit`);
  }

  try {
    return JSON.parse(read.text);
  } catch {
    throw invalidResponse(context, 'body', 'not valid JSON');
  }
}
