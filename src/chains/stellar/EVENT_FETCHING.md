# Stellar announcement event fetching

This document describes how `@wraith-protocol/sdk/chains/stellar` ingests Soroban
announcer events and the privacy trade-offs of RPC topic filtering.

## Announcer versions

| Version | Contract field | Topic layout                                      | RPC bucket filter |
| ------- | -------------- | ------------------------------------------------- | ----------------- |
| v1      | `announcer`    | `("announce", scheme_id, stealth_address)`        | No                |
| v2      | `announcerV2`  | `("announce", 2, view_tag_bucket, metadata_kind)` | Yes               |

During the v1 → v2 migration window, `fetchAnnouncements()` reads from **both**
contracts when `announcerV2` is configured in deployments.

## Bucketed `getEvents` queries (v2)

For v2 announcements, the SDK builds Soroban RPC filters:

```
("announce", 2, view_tag_bucket, *)
```

Pass explicit buckets to avoid downloading the full v2 stream:

```typescript
import { fetchAnnouncements, viewTagToBucket } from '@wraith-protocol/sdk/chains/stellar';

const bucket = viewTagToBucket(0x2a);
const announcements = await fetchAnnouncements('stellar', {
  viewTagBuckets: [bucket],
});
```

When `viewTagBuckets` is omitted, the SDK uses `("announce", 2, *, *)` on the v2
contract. v1 events are always fetched without bucket filters because
`stealth_address` occupies topic slot 2 in the legacy layout.

## Client-side validation

RPC topic filters reduce bandwidth only. Recipients must still run
`scanAnnouncements()` to cryptographically verify each candidate event against
their viewing key. Never treat RPC-filtered events as trusted payments.

## Privacy trade-off

Indexing `view_tag_bucket` in a public Soroban topic leaks one byte of
correlation per payment. With 256 buckets, observers (including the RPC provider
when you pass bucket filters) can group announcements by approximate recipient
identity.

| Strategy                          | Bandwidth | Query privacy |
| --------------------------------- | --------- | ------------- |
| v1 full stream                    | Highest   | Lowest        |
| v2 single-bucket filter           | Lowest    | Lower         |
| v2 all-bucket wildcard            | Medium    | Medium        |
| Private indexer / self-hosted RPC | Varies    | Highest       |

For most users, 256 buckets is a reasonable balance. Choose single-bucket
filters when RPC egress cost dominates; prefer broader queries or a private
indexer when query pattern privacy dominates.

## Filter batching

Soroban RPC accepts at most five event filters per `getEvents` request. When
more than five buckets are requested, the SDK splits them into sequential
batches via `buildV2BucketEventFilterBatches()`.

## Related issues

- contracts [#23](https://github.com/wraith-protocol/contracts/issues/23) — topic design
- contracts [#24](https://github.com/wraith-protocol/contracts/issues/24) — v2 announcer contract
- contracts [#25](https://github.com/wraith-protocol/contracts/issues/25) — SDK bucketed fetch (this module)
