import { describe, test, expect } from 'vitest';
import { xdr } from '@stellar/stellar-sdk';
import {
  ANNOUNCE_EVENT_SYMBOL,
  SCHEME_ID_V2,
  VIEW_TAG_BUCKET_COUNT,
} from '../../../src/chains/stellar/constants';
import {
  buildV1AnnouncerEventFilter,
  buildV2AllBucketsEventFilter,
  buildV2BucketEventFilter,
  buildV2BucketEventFilterBatches,
  encodeSymbolTopic,
  encodeU32Topic,
  MAX_RPC_EVENT_FILTERS,
  viewTagToBucket,
} from '../../../src/chains/stellar/event-filters';

const V1_CONTRACT = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
const V2_CONTRACT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

describe('viewTagToBucket', () => {
  test('uses the view tag byte directly as the bucket index', () => {
    expect(viewTagToBucket(0)).toBe(0);
    expect(viewTagToBucket(42)).toBe(42);
    expect(viewTagToBucket(255)).toBe(255);
  });

  test('rejects out-of-range values', () => {
    expect(() => viewTagToBucket(-1)).toThrow(RangeError);
    expect(() => viewTagToBucket(256)).toThrow(RangeError);
  });
});

describe('topic encoders', () => {
  test('encodeSymbolTopic round-trips announce symbol', () => {
    const encoded = encodeSymbolTopic(ANNOUNCE_EVENT_SYMBOL);
    const decoded = xdr.ScVal.fromXDR(encoded, 'base64');
    expect(decoded.sym().toString()).toBe(ANNOUNCE_EVENT_SYMBOL);
  });

  test('encodeU32Topic round-trips scheme and bucket values', () => {
    for (const value of [1, 2, 42, 255]) {
      const encoded = encodeU32Topic(value);
      expect(xdr.ScVal.fromXDR(encoded, 'base64').u32()).toBe(value);
    }
  });
});

describe('buildV1AnnouncerEventFilter', () => {
  test('targets the v1 announcer with three topic slots', () => {
    const filter = buildV1AnnouncerEventFilter(V1_CONTRACT);
    expect(filter).toEqual({
      type: 'contract',
      contractIds: [V1_CONTRACT],
      topics: [[encodeSymbolTopic(ANNOUNCE_EVENT_SYMBOL), '*', '*']],
    });
  });
});

describe('buildV2BucketEventFilter', () => {
  test('builds ("announce", 2, view_tag_bucket, *) filter', () => {
    const bucket = 77;
    const filter = buildV2BucketEventFilter(V2_CONTRACT, bucket);

    expect(filter.type).toBe('contract');
    expect(filter.contractIds).toEqual([V2_CONTRACT]);
    expect(filter.topics).toHaveLength(1);

    const [announce, scheme, viewTagBucket, wildcard] = filter.topics![0];
    expect(xdr.ScVal.fromXDR(announce, 'base64').sym().toString()).toBe(ANNOUNCE_EVENT_SYMBOL);
    expect(xdr.ScVal.fromXDR(scheme, 'base64').u32()).toBe(SCHEME_ID_V2);
    expect(xdr.ScVal.fromXDR(viewTagBucket, 'base64').u32()).toBe(bucket);
    expect(wildcard).toBe('*');
  });

  test('rejects invalid bucket indices', () => {
    expect(() => buildV2BucketEventFilter(V2_CONTRACT, -1)).toThrow(RangeError);
    expect(() => buildV2BucketEventFilter(V2_CONTRACT, VIEW_TAG_BUCKET_COUNT)).toThrow(RangeError);
  });
});

describe('buildV2AllBucketsEventFilter', () => {
  test('wildcard bucket and metadata_kind slots', () => {
    const filter = buildV2AllBucketsEventFilter(V2_CONTRACT);
    expect(filter.topics).toEqual([
      [encodeSymbolTopic(ANNOUNCE_EVENT_SYMBOL), encodeU32Topic(SCHEME_ID_V2), '*', '*'],
    ]);
  });
});

describe('buildV2BucketEventFilterBatches', () => {
  test('deduplicates buckets and respects RPC filter limit', () => {
    const buckets = [1, 2, 3, 4, 5, 6, 1];
    const batches = buildV2BucketEventFilterBatches(V2_CONTRACT, buckets);

    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(MAX_RPC_EVENT_FILTERS);
    expect(batches[1]).toHaveLength(1);
  });
});
