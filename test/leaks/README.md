# Leak regression harness

The SDK has two complementary leak checks:

- `scan-leak.test.ts` tracks the slope of `heapUsed` over repeated scans and fails when it exceeds a configured MB-per-step threshold.
- `heap-snapshot.test.ts` compares retained object counts by constructor between deterministic before/after V8 heap snapshots.

The constructor-level harness is intended to catch slow retention bugs such as leaked `WeakRef` instances, buffers, or pooled objects that can hide inside a stable aggregate heap slope.

## Running locally

Both harnesses require explicit garbage collection so their measurements are stable:

```bash
pnpm test:leak
pnpm test:heap-leak
```

Each script launches Vitest through Node with `--expose-gc` and uses the thread pool so the test worker retains explicit GC access.

`scan-leak` writes `scan-leak-diagnostics.json` with the recorded samples, the fitted slope, and the active threshold. It also writes `heap-final.heapsnapshot` when the gate fails so the retained graph can be inspected.

`heap-snapshot` writes these files in the repository root:

- `heap-before.heapsnapshot`
- `heap-after.heapsnapshot`
- `heap-diff.json`

`heap-diff.json` contains the complete constructor count delta, sorted by retained growth, plus any constructors that exceeded the configured threshold.

## Configuration

The following environment variables can be used to tune a run:

| Variable                            | Default | Meaning                                                                           |
| ----------------------------------- | ------: | --------------------------------------------------------------------------------- |
| `SCAN_LEAK_ANNOUNCEMENTS`           |  `2000` | Announcements generated for the scan workload                                     |
| `SCAN_LEAK_ITERATIONS`              |   `300` | Number of measured scan iterations                                                |
| `SCAN_LEAK_SAMPLE_INTERVAL`         |    `25` | Iterations between heap samples                                                   |
| `SCAN_LEAK_THRESHOLD_MB`            |   `0.2` | Maximum allowed regression slope in MB per sample step                            |
| `SCAN_LEAK_INJECT`                  |   unset | Set to `1` to deliberately retain `LeakSentinel` objects and prove the gate fails |
| `HEAP_ANNOUNCEMENTS`                |  `1000` | Announcements generated for the scan workload                                     |
| `HEAP_SCANS`                        |   `100` | Number of measured scan iterations                                                |
| `HEAP_CONSTRUCTOR_GROWTH_THRESHOLD` |    `25` | Maximum retained-object growth allowed for any constructor                        |
| `HEAP_LEAK_INJECT`                  |   unset | Set to `1` to deliberately retain `LeakSentinel` objects and prove the gate fails |

## Reproducibility

Run either harness twice from the same commit with the same Node version and configuration. Both force GC before measuring: `scan-leak` fits a least-squares line to sampled `heapUsed`, and `heap-snapshot` compares constructor counts using the V8 snapshot schema rather than process-level heap estimates. Small runtime bookkeeping differences are tolerated by the configured thresholds; application-level retained growth above a threshold fails the test.

## Regression proof

To verify that each harness detects a known leak:

```bash
SCAN_LEAK_INJECT=1 pnpm test:leak
HEAP_LEAK_INJECT=1 pnpm test:heap-leak
```

Those runs intentionally keep one `LeakSentinel` alive per iteration or scan. The measured slope or constructor count should exceed the threshold and the test should fail. Do not enable these variables in normal CI.

## CI

The regular per-PR test job does not run either harness because heap snapshots are intentionally heavier and environment-sensitive. Scheduled nightly jobs run `pnpm test:leak` and `pnpm test:heap-leak` on Node 22 and upload only the compact diagnostics (`scan-leak-diagnostics.json` and `heap-diff.json`) when a gate fails. A separate nightly job injects a deliberate leak into each harness and fails when either gate reports success.
