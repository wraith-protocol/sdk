import type { Announcement } from './types';
import { bytesToHex, base58Encode } from './utils';
import {
  invalidResponse,
  MAX_RPC_RESPONSE_BYTES,
  requireArray,
  requireRecord,
  requireString,
  type RPCResponseContext,
} from '../rpcValidation';

/** Largest Solana RPC body accepted per request, in bytes. */
export const MAX_SOLANA_RESPONSE_BYTES = MAX_RPC_RESPONSE_BYTES;

/** Most signatures accepted from one `getSignaturesForAddress` page. */
export const MAX_SOLANA_SIGNATURES = 1000;

/** Most log messages accepted from one transaction. */
export const MAX_TRANSACTION_LOG_MESSAGES = 1024;

/** Longest single log line accepted, in characters. */
export const MAX_TRANSACTION_LOG_CHARS = 16_384;

/** Largest announcement metadata payload accepted, in bytes. */
export const MAX_ANNOUNCEMENT_METADATA_BYTES = 1024;

/** Anchor event discriminator: first 8 bytes of SHA-256("event:AnnouncementEvent"). */
export const ANNOUNCEMENT_EVENT_DISCRIMINATOR = [0xfa, 0xb0, 0x2a, 0xef, 0x3c, 0xad, 0x36, 0x88];

const PROGRAM_DATA_PREFIX = 'Program data:';
/** schemeId (4) + stealth (32) + caller (32) + ephemeral (32) + metadata length (4). */
const ANNOUNCEMENT_FIXED_BYTES = 8 + 4 + 32 + 32 + 32 + 4;

/**
 * Wraps `fetch` so a Solana RPC response is buffered only within a size limit
 * and rejected before `@solana/web3.js` parses it.
 *
 * A non-2xx response is passed through unchanged: the client turns it into its
 * own error with the status intact.
 */
export function createBoundedSolanaFetch(
  context: RPCResponseContext,
  maxBytes = MAX_SOLANA_RESPONSE_BYTES,
): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    if (!response.ok) return response;

    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw invalidResponse(
        context,
        'body',
        `${declaredLength} bytes exceeds the ${maxBytes} byte limit`,
      );
    }

    // React Native and some fetch polyfills expose `fetch` without the
    // `Response` constructor; the declared length check above still applies,
    // but the body cannot be re-wrapped after it is read.
    if (typeof Response === 'undefined') return response;

    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw invalidResponse(context, 'body', `response is longer than the ${maxBytes} byte limit`);
    }

    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

/**
 * Validates a `getSignaturesForAddress` result and returns the signatures.
 *
 * Accepts only `{ signature }` records with a bounded, non-empty string.
 */
export function parseSignaturePage(result: unknown, context: RPCResponseContext): string[] {
  const entries = requireArray(result, context, 'result', MAX_SOLANA_SIGNATURES);
  return entries.map((entry, index) => {
    const field = `result[${index}]`;
    // Some providers return bare signature strings instead of `{ signature }`.
    if (typeof entry === 'string') {
      return requireString(entry, context, field, { minLength: 1, maxLength: 128 });
    }
    const record = requireRecord(entry, context, field);
    return requireString(record.signature, context, `${field}.signature`, {
      minLength: 1,
      maxLength: 128,
    });
  });
}

/**
 * Validates the log messages of a `getTransaction` result.
 *
 * Returns `null` when the transaction is unknown or carries no logs, which the
 * caller treats as "nothing to scan", and the bounded log array otherwise.
 */
export function parseTransactionLogs(
  transaction: unknown,
  context: RPCResponseContext,
): string[] | null {
  if (transaction === null || transaction === undefined) return null;

  const record = requireRecord(transaction, context, 'result');
  const meta = record.meta;
  if (meta === undefined || meta === null) return null;
  const metaRecord = requireRecord(meta, context, 'result.meta');

  const logs = metaRecord.logMessages;
  if (logs === undefined || logs === null) return null;

  const entries = requireArray(
    logs,
    context,
    'result.meta.logMessages',
    MAX_TRANSACTION_LOG_MESSAGES,
  );
  return entries.map((entry, index) =>
    requireString(entry, context, `result.meta.logMessages[${index}]`, {
      maxLength: MAX_TRANSACTION_LOG_CHARS,
    }),
  );
}

/** Decodes standard or base64url data, rejecting invalid input. */
function decodeBase64(value: string, context: RPCResponseContext, field: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(padded)) {
    throw invalidResponse(context, field, 'not valid base64');
  }

  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw invalidResponse(context, field, 'not valid base64');
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Parses every announcement event from a transaction's log messages.
 *
 * Log lines that are not `Program data:` output or do not carry the Anchor
 * announcement discriminator are skipped. A matching event whose payload is
 * truncated, oversized or otherwise malformed throws an
 * {@link RPCResponseError} instead of being decoded.
 */
export function parseAnnouncementLogs(
  logs: unknown,
  context: RPCResponseContext,
  field: string,
): Announcement[] {
  const entries = requireArray(logs, context, field, MAX_TRANSACTION_LOG_MESSAGES);
  const announcements: Announcement[] = [];

  for (let index = 0; index < entries.length; index++) {
    const lineField = `${field}[${index}]`;
    const line = requireString(entries[index], context, lineField, {
      maxLength: MAX_TRANSACTION_LOG_CHARS,
    });
    if (!line.startsWith(PROGRAM_DATA_PREFIX)) continue;

    const bytes = decodeBase64(line.slice(PROGRAM_DATA_PREFIX.length).trim(), context, lineField);
    if (bytes.length < ANNOUNCEMENT_EVENT_DISCRIMINATOR.length) continue;
    if (!ANNOUNCEMENT_EVENT_DISCRIMINATOR.every((byte, i) => byte === bytes[i])) continue;

    if (bytes.length < ANNOUNCEMENT_FIXED_BYTES) {
      throw invalidResponse(
        context,
        lineField,
        `announcement payload is truncated (${bytes.length} bytes)`,
      );
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = ANNOUNCEMENT_EVENT_DISCRIMINATOR.length;

    const schemeId = view.getUint32(offset, true);
    offset += 4;

    const stealthAddress = bytes.slice(offset, offset + 32);
    offset += 32;

    const caller = bytes.slice(offset, offset + 32);
    offset += 32;

    const ephemeralPubKey = bytes.slice(offset, offset + 32);
    offset += 32;

    const metadataLen = view.getUint32(offset, true);
    offset += 4;

    if (metadataLen > MAX_ANNOUNCEMENT_METADATA_BYTES) {
      throw invalidResponse(
        context,
        lineField,
        `metadata length ${metadataLen} exceeds the ${MAX_ANNOUNCEMENT_METADATA_BYTES} byte limit`,
      );
    }
    if (metadataLen > bytes.length - offset) {
      throw invalidResponse(
        context,
        lineField,
        `metadata length ${metadataLen} exceeds the remaining ${bytes.length - offset} bytes`,
      );
    }

    const metadata = bytes.slice(offset, offset + metadataLen);

    announcements.push({
      schemeId,
      stealthAddress: base58Encode(stealthAddress),
      caller: base58Encode(caller),
      ephemeralPubKey: bytesToHex(new Uint8Array(ephemeralPubKey)),
      metadata: bytesToHex(new Uint8Array(metadata)),
    });
  }

  return announcements;
}
