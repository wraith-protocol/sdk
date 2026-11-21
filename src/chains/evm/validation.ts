import type { Announcement, HexString } from './types';
import {
  invalidResponse,
  isRecord,
  requireArray,
  requireBigInt,
  requireHex,
  requireRecord,
  type RPCResponseContext,
} from '../rpcValidation';

/** Largest number of announcements accepted from one subgraph page. */
export const MAX_ANNOUNCEMENTS_PER_PAGE = 1000;

/** Largest ERC-5564 metadata payload accepted, in bytes. */
export const MAX_ANNOUNCEMENT_METADATA_BYTES = 4096;

/** Largest number of GraphQL errors reported in a validation message. */
const MAX_GRAPHQL_ERRORS = 100;

function assertNoGraphQLErrors(
  record: Record<string, unknown>,
  context: RPCResponseContext,
  field: string,
): void {
  if (record.errors === undefined) return;
  const errors = requireArray(record.errors, context, `${field}.errors`, MAX_GRAPHQL_ERRORS);
  if (errors.length > 0) {
    // Messages are provider-controlled: report the count, never the contents.
    throw invalidResponse(
      context,
      `${field}.errors`,
      `endpoint returned ${errors.length} GraphQL error(s)`,
    );
  }
}

/**
 * Unwraps the response envelopes produced by the subgraph gateways the SDK
 * supports: `{ data }`, `{ result: { data } }` and repeated `data` wrappers.
 */
function unwrapSubgraphData(
  payload: unknown,
  context: RPCResponseContext,
): Record<string, unknown> {
  let current: Record<string, unknown> = requireRecord(payload, context, 'body');

  for (let depth = 0; depth < 3; depth++) {
    assertNoGraphQLErrors(current, context, depth === 0 ? 'body' : `body.depth${depth}`);
    if (isRecord(current.data)) {
      current = current.data;
      continue;
    }
    if (isRecord(current.result)) {
      current = current.result;
      continue;
    }
    return current;
  }

  throw invalidResponse(context, 'body', 'response envelope is nested too deeply');
}

/**
 * Extracts the announcements array from a page, accepting both the standard
 * `data.announcements` array and the `data.announcements.nodes` variant.
 */
function extractAnnouncements(
  data: Record<string, unknown>,
  context: RPCResponseContext,
): { records: unknown[]; field: string } {
  const raw = data.announcements;
  if (raw === undefined || raw === null) {
    throw invalidResponse(context, 'data.announcements', 'missing');
  }
  if (Array.isArray(raw)) {
    return {
      records: requireArray(raw, context, 'data.announcements', MAX_ANNOUNCEMENTS_PER_PAGE),
      field: 'data.announcements',
    };
  }
  if (isRecord(raw)) {
    if (raw.nodes === undefined || raw.nodes === null) {
      throw invalidResponse(context, 'data.announcements.nodes', 'missing');
    }
    return {
      records: requireArray(
        raw.nodes,
        context,
        'data.announcements.nodes',
        MAX_ANNOUNCEMENTS_PER_PAGE,
      ),
      field: 'data.announcements.nodes',
    };
  }
  throw invalidResponse(context, 'data.announcements', 'expected an array or { nodes } object');
}

/**
 * Validates one subgraph announcement record and normalizes it into the SDK's
 * {@link Announcement} shape.
 *
 * Both decimal and hex integer encodings are accepted for `schemeId`, hex is
 * accepted with or without its `0x` prefix, and an absent metadata payload is
 * normalized to `0x`.
 */
export function parseSubgraphAnnouncement(
  record: unknown,
  context: RPCResponseContext,
  field: string,
): Announcement {
  const data = requireRecord(record, context, field);

  const metadataRaw = data.metadata;
  const metadata =
    metadataRaw === undefined || metadataRaw === null
      ? '0x'
      : requireHex(metadataRaw, context, `${field}.metadata`, {
          allowEmpty: true,
          maxBytes: MAX_ANNOUNCEMENT_METADATA_BYTES,
        });

  return {
    schemeId: requireBigInt(data.schemeId, context, `${field}.schemeId`, {
      min: 0n,
      max: 0xffffffffn,
    }),
    stealthAddress: requireHex(data.stealthAddress, context, `${field}.stealthAddress`, {
      bytes: 20,
    }) as HexString,
    caller: requireHex(data.caller, context, `${field}.caller`, { bytes: 20 }) as HexString,
    ephemeralPubKey: requireHex(data.ephemeralPubKey, context, `${field}.ephemeralPubKey`, {
      bytes: 33,
    }) as HexString,
    metadata: metadata as HexString,
  };
}

/** A validated subgraph page. */
export interface SubgraphAnnouncementPage {
  /** Announcements parsed from the page. */
  announcements: Announcement[];
  /** Raw record count, used to decide whether another page is required. */
  recordCount: number;
}

/**
 * Validates one subgraph page and returns its normalized announcements.
 *
 * Every field is checked before conversion, so malformed records never reach
 * address matching or key derivation.
 */
export function parseSubgraphAnnouncementsPage(
  payload: unknown,
  context: RPCResponseContext,
): SubgraphAnnouncementPage {
  const data = unwrapSubgraphData(payload, context);
  const { records, field } = extractAnnouncements(data, context);

  const announcements = records.map((record, index) =>
    parseSubgraphAnnouncement(record, context, `${field}[${index}]`),
  );

  return { announcements, recordCount: records.length };
}
