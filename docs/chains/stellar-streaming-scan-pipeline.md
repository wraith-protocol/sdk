# Stellar streaming scan: overlapping RPC with CPU work

## Problem

`scanAnnouncementsStream` pulled announcements from its `source` in strict windows:
await up to `window` items from the source, then scan all of them, then repeat. While a
window was being scanned, the source (typically {@link fetchAnnouncementsStream} paging
through Soroban RPC) sat idle — no fetch for the next page could start until the current
window finished. On a cold scan, that serializes RPC latency and CPU decrypt cost that
could otherwise overlap.

## Chosen design

`src/chains/stellar/scanner/pipeline.ts` adds a generic `pipeline(source, capacity)`
helper: a bounded producer/consumer queue. A background pump keeps pulling from `source`
up to `capacity` items ahead of what the consumer has read. Because starting the next pull
from `source` kicks off its I/O immediately, that I/O runs concurrently with whatever
synchronous work the consumer is doing on already-buffered items — Node's event loop keeps
an in-flight `fetch()` progressing in the background while the main thread executes CPU
work on the previous batch.

`scanAnnouncementsStream` now wraps its `source` in `pipeline(source, window)` and scans
each item as it's pulled from the pipeline, instead of prefetching a window strictly before
scanning any of it:

```ts
const piped = pipeline(source, windowSize);
for await (const ann of piped) {
  // scan ann immediately; the pipeline is already fetching ahead in the background
}
```

The pump pauses once `capacity` items are buffered, so an adversarially fast source paired
with a slow scan still can't grow memory past O(window) — the same bound the old
windowed implementation had.

`fetchAnnouncementsStream`'s public shape is unchanged: it's still a plain async generator
that yields one announcement at a time. `scanAnnouncementsStream`'s signature is also
unchanged. The old windowed algorithm is kept as `scanAnnouncementsStreamSequential`,
exported alongside `scanAnnouncementsStream` for benchmark comparisons, matching how
`scanAnnouncementsLegacySharedSecretTag` is retained for the view-tag-batching benchmark.

## Cancellation and errors

Breaking out of the consumer's `for-await` loop calls `.return()` on the pipeline, which
calls `.return()` on `source` in its `finally` block — the same cancellation contract the
old implementation had, verified by the existing `scanAnnouncementsStream` cancellation
test. Errors thrown by `source` propagate to the consumer once any already-buffered items
are drained.

## Benchmarks

The benchmark harness lives at `test/chains/stellar/bench/scan.bench.ts`, in the "Stellar
streaming scan pipelining" section. It mimics `fetchAnnouncementsStream`'s paging with a
mock source that pays a fixed page latency (15ms) per 1,000-announcement page, then
compares:

1. `scanAnnouncementsStreamSequential` — window-then-scan, no overlap.
2. `scanAnnouncementsStream` — pipelined fetch+scan.

Run it with:

```bash
pnpm exec vitest bench test/chains/stellar/bench/scan.bench.ts --run
```

On this development container, the 10k-announcement canned dataset reported:

| Dataset              | Before: sequential window | After: pipelined | Speedup |
| -------------------- | ------------------------: | ---------------: | ------: |
| 10,000 announcements |                 537.14 ms |        343.50 ms |   1.56x |

That's a 36% reduction in wall-clock time, clearing the 30% target. The gain scales with
how many pages a cold scan spans and how close `window` is to the source's page size —
a `window` much smaller than the page size limits how far the pump can prefetch ahead of
the scan.

`test/chains/stellar/scanner/pipeline.test.ts` additionally asserts the underlying overlap
mechanism directly (a mock producer/consumer pair with matched I/O and CPU delays), and
asserts the bounded-queue backpressure property with a fast producer paired with an
artificially slow consumer, so both acceptance criteria run under `pnpm test`, not just the
excluded `bench/` folder.
