# Leak regression harness

The SDK has two complementary leak checks:

- `scan-leak.test.ts` tracks the slope of `heapUsed` over repeated scans.
- `heap-snapshot.test.ts` compares retained object counts by constructor between deterministic before/after V8 heap snapshots.

The constructor-level harness is intended to catch slow retention bugs such as leaked `WeakRef` instances, buffers, or pooled objects that can hide inside a stable aggregate heap slope.

## Running locally

The harness requires explicit garbage collection so the before/after snapshots are comparable:

```bash
pnpm test:heap-leak
```

This script launches Vitest through Node with `--expose-gc` and uses the thread pool so the test worker retains explicit GC access. It writes these files in the repository root:

- `heap-before.heapsnapshot`
- `heap-after.heapsnapshot`
- `heap-diff.json`

`heap-diff.json` contains the complete constructor count delta, sorted by retained growth, plus any constructors that exceeded the configured threshold.

## Configuration

The following environment variables can be used to tune a run:

| Variable                            | Default | Meaning                                                                           |
| ----------------------------------- | ------: | --------------------------------------------------------------------------------- |
| `HEAP_ANNOUNCEMENTS`                |  `1000` | Announcements generated for the scan workload                                     |
| `HEAP_SCANS`                        |   `100` | Number of measured scan iterations                                                |
| `HEAP_CONSTRUCTOR_GROWTH_THRESHOLD` |    `25` | Maximum retained-object growth allowed for any constructor                        |
| `HEAP_LEAK_INJECT`                  |   unset | Set to `1` to deliberately retain `LeakSentinel` objects and prove the gate fails |

## Reproducibility

Run `pnpm test:heap-leak` twice from the same commit with the same Node version and configuration. The harness forces GC before each snapshot and reports constructor counts using the V8 snapshot schema rather than process-level heap estimates. Small runtime bookkeeping differences are tolerated by the configured growth threshold; application-level retained growth above that threshold fails the test.

## Regression proof

To verify that the harness detects a known leak:

```bash
HEAP_LEAK_INJECT=1 pnpm test:heap-leak
```

That run intentionally keeps one `LeakSentinel` per scan alive. The constructor count should exceed the threshold and the test should fail. Do not enable this variable in normal CI.

## CI

The regular per-PR test job does not run the heap snapshot harness because heap snapshots are intentionally heavier and environment-sensitive. The scheduled nightly job runs `pnpm test:heap-leak` on Node 22 and uploads `heap-diff.json` together with the before/after snapshots as a GitHub Actions artifact, even when the regression gate fails.
