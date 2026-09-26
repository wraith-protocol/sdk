import { xdr } from '@stellar/stellar-sdk';
import { ANNOUNCE_EVENT_SYMBOL, SCHEME_ID_V2, VIEW_TAG_BUCKET_COUNT } from './constants';

/** Soroban RPC allows at most five event filters per `getEvents` request. */
export const MAX_RPC_EVENT_FILTERS = 5;

/** A single positional topic matcher passed to Soroban RPC `getEvents`. */
export type SorobanTopicMatcher = string[];

/** Contract event filter for Soroban RPC `getEvents`. */
export interface SorobanEventFilter {
  type: 'contract';
  contractIds: string[];
  topics?: SorobanTopicMatcher[];
}

/** Encodes a short symbol (`Symbol`) ScVal topic segment as base64 XDR. */
export function encodeSymbolTopic(symbol: string): string {
  return xdr.ScVal.scvSymbol(symbol).toXDR('base64');
}

/** Encodes a `u32` ScVal topic segment as base64 XDR. */
export function encodeU32Topic(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`u32 topic value out of range: ${value}`);
  }
  return xdr.ScVal.scvU32(value).toXDR('base64');
}

/**
 * Derives the v2 announcer view-tag bucket from a 1-byte view tag.
 *
 * Buckets align with the on-chain topic layout from contracts issue #24:
 * the first metadata byte (view tag) is indexed directly as topic 2.
 */
export function viewTagToBucket(viewTag: number): number {
  if (!Number.isInteger(viewTag) || viewTag < 0 || viewTag > 255) {
    throw new RangeError(`view tag must be an integer in 0..255, got ${viewTag}`);
  }
  return viewTag;
}

/** Validates a view-tag bucket index (0..255). */
export function assertViewTagBucket(bucket: number): void {
  if (!Number.isInteger(bucket) || bucket < 0 || bucket >= VIEW_TAG_BUCKET_COUNT) {
    throw new RangeError(
      `view tag bucket must be an integer in 0..${VIEW_TAG_BUCKET_COUNT - 1}, got ${bucket}`,
    );
  }
}

/**
 * v1 announcer topic filter: `("announce", *, *)`.
 *
 * v1 events cannot be filtered by view-tag bucket at the RPC layer because
 * `stealth_address` occupies topic slot 2. Clients must download the full v1
 * stream and apply cryptographic validation locally.
 */
export function buildV1AnnouncerEventFilter(contractId: string): SorobanEventFilter {
  return {
    type: 'contract',
    contractIds: [contractId],
    topics: [[encodeSymbolTopic(ANNOUNCE_EVENT_SYMBOL), '*', '*']],
  };
}

/**
 * v2 announcer bucket filter: `("announce", 2, view_tag_bucket, *)`.
 *
 * Restricts the RPC response to announcements whose view-tag bucket matches
 * `viewTagBucket`, eliminating ~255/256 of v2 traffic for that bucket query.
 */
export function buildV2BucketEventFilter(
  contractId: string,
  viewTagBucket: number,
): SorobanEventFilter {
  assertViewTagBucket(viewTagBucket);
  return {
    type: 'contract',
    contractIds: [contractId],
    topics: [
      [
        encodeSymbolTopic(ANNOUNCE_EVENT_SYMBOL),
        encodeU32Topic(SCHEME_ID_V2),
        encodeU32Topic(viewTagBucket),
        '*',
      ],
    ],
  };
}

/**
 * v2 announcer catch-all filter: `("announce", 2, *, *)`.
 *
 * Returns every v2 announcement regardless of bucket. Prefer
 * {@link buildV2BucketEventFilter} when the caller only needs specific buckets.
 */
export function buildV2AllBucketsEventFilter(contractId: string): SorobanEventFilter {
  return {
    type: 'contract',
    contractIds: [contractId],
    topics: [[encodeSymbolTopic(ANNOUNCE_EVENT_SYMBOL), encodeU32Topic(SCHEME_ID_V2), '*', '*']],
  };
}

/**
 * Builds v2 bucket filters in RPC-sized batches (max five filters per request).
 */
export function buildV2BucketEventFilterBatches(
  contractId: string,
  viewTagBuckets: number[],
): SorobanEventFilter[][] {
  const uniqueBuckets = [...new Set(viewTagBuckets)];
  uniqueBuckets.forEach(assertViewTagBucket);

  const filters = uniqueBuckets.map((bucket) => buildV2BucketEventFilter(contractId, bucket));
  const batches: SorobanEventFilter[][] = [];

  for (let i = 0; i < filters.length; i += MAX_RPC_EVENT_FILTERS) {
    batches.push(filters.slice(i, i + MAX_RPC_EVENT_FILTERS));
  }

  return batches;
}
