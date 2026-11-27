import type { HexString, StealthCell } from './types';
import {
  invalidResponse,
  isRecord,
  requireArray,
  requireBigInt,
  requireHex,
  requireRecord,
  requireString,
  type RPCResponseContext,
} from '../rpcValidation';

/** Most cells accepted from one indexer `get_cells` page. */
export const MAX_CKB_CELLS_PER_PAGE = 100;

/** Longest indexer pagination cursor accepted, in characters. */
export const MAX_CKB_CURSOR_CHARS = 512;

/** Largest CKB capacity (u64 shannons). */
export const MAX_CKB_CAPACITY = 18_446_744_073_709_551_615n;

/** Largest cell index (u32). */
export const MAX_CKB_CELL_INDEX = 0xffff_ffffn;

/** Length of a CKB stealth lock's args: ephemeral (33) || blake160 (20). */
export const STEALTH_LOCK_ARGS_BYTES = 53;

/** A validated `get_cells` page. */
export interface StealthCellPage {
  /** Validated stealth cells; cells with non-stealth args are skipped. */
  cells: StealthCell[];
  /** Raw object count, used to decide whether another page is required. */
  rawCount: number;
  /** Cursor for the next page, or `null` when the indexer has no more data. */
  cursor: string | null;
}

/**
 * Extracts the result object from either the standard `{ result }` envelope or
 * the `{ data }` wrapper some indexer gateways return.
 */
function unwrapResult(payload: unknown, context: RPCResponseContext): Record<string, unknown> {
  const root = requireRecord(payload, context, 'body');

  const error = root.error;
  if (error !== undefined && error !== null) {
    const code = isRecord(error) ? error.code : undefined;
    const detail = typeof code === 'number' && Number.isInteger(code) ? ` (code ${code})` : '';
    throw invalidResponse(context, 'body.error', `JSON-RPC error response${detail}`);
  }

  if (isRecord(root.result)) return root.result;
  if (isRecord(root.data)) return root.data;
  throw invalidResponse(context, 'body.result', `expected an object, got ${typeof root.result}`);
}

/**
 * Validates one CKB cell and normalizes its identifiers.
 *
 * Hex is accepted with or without the `0x` prefix, and capacity/index may be
 * encoded as decimals or hex. Cells whose lock args are empty are not stealth
 * cells and are skipped; args of any other unexpected length are rejected.
 */
function parseStealthCell(
  value: unknown,
  context: RPCResponseContext,
  field: string,
): StealthCell | null {
  const cell = requireRecord(value, context, field);

  const outPoint = requireRecord(cell.out_point, context, `${field}.out_point`);
  const txHash = requireHex(outPoint.tx_hash, context, `${field}.out_point.tx_hash`, {
    bytes: 32,
  }) as HexString;
  const index = Number(
    requireBigInt(outPoint.index, context, `${field}.out_point.index`, {
      min: 0n,
      max: MAX_CKB_CELL_INDEX,
    }),
  );

  const output = requireRecord(cell.output, context, `${field}.output`);
  const capacity = requireBigInt(output.capacity, context, `${field}.output.capacity`, {
    min: 0n,
    max: MAX_CKB_CAPACITY,
  });

  const lock = requireRecord(output.lock, context, `${field}.output.lock`);
  const lockArgs = requireHex(lock.args, context, `${field}.output.lock.args`, {
    allowEmpty: true,
    maxBytes: STEALTH_LOCK_ARGS_BYTES,
  });
  const argsBytes = (lockArgs.length - 2) / 2;
  if (argsBytes === 0) return null;
  if (argsBytes !== STEALTH_LOCK_ARGS_BYTES) {
    throw invalidResponse(
      context,
      `${field}.output.lock.args`,
      `expected ${STEALTH_LOCK_ARGS_BYTES} bytes, got ${argsBytes} bytes`,
    );
  }

  return {
    txHash,
    index,
    capacity,
    lockArgs: lockArgs as HexString,
    ephemeralPubKey: `0x${lockArgs.slice(2, 68)}` as HexString,
    stealthPubKeyHash: `0x${lockArgs.slice(68)}` as HexString,
  };
}

/**
 * Validates one `get_cells` page and returns its normalized stealth cells.
 *
 * Malformed identifiers, lengths, numbers and nested objects are rejected
 * before any value is turned into a bigint or used to build a stealth cell.
 */
export function parseStealthCellPage(
  payload: unknown,
  context: RPCResponseContext,
): StealthCellPage {
  const result = unwrapResult(payload, context);
  const objects = requireArray(result.objects, context, 'result.objects', MAX_CKB_CELLS_PER_PAGE);

  const cells: StealthCell[] = [];
  for (let index = 0; index < objects.length; index++) {
    const cell = parseStealthCell(objects[index], context, `result.objects[${index}]`);
    if (cell) cells.push(cell);
  }

  const rawCursor = result.last_cursor;
  const cursor =
    rawCursor === undefined || rawCursor === null
      ? null
      : requireString(rawCursor, context, 'result.last_cursor', {
          minLength: 1,
          maxLength: MAX_CKB_CURSOR_CHARS,
        });

  return { cells, rawCount: objects.length, cursor };
}
