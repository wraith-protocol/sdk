# Scan Leak Debugging

The scan leak harness exercises the EVM `scanAnnouncements` hot path with a synthetic
10,000-announcement dataset for 10,000 scan iterations. It samples RSS, heap, and external
memory, writes heap snapshots, and fails when RSS grows faster than the configured slope.

## Run the Leak Test

```sh
pnpm run test:leak
```

The script runs Node with `--expose-gc`, so the harness forces GC before samples and runs the
WeakRef retention check. Generated artifacts are written to `test/leak/artifacts/`.

Useful tuning knobs:

```sh
LEAK_ITERATIONS=10000 \
LEAK_ANNOUNCEMENTS=10000 \
LEAK_SAMPLE_INTERVAL=100 \
LEAK_SNAPSHOT_INTERVAL=2500 \
LEAK_MAX_RSS_SLOPE_KB=2 \
pnpm run test:leak
```

Set `LEAK_SNAPSHOT_INTERVAL=0` to disable heap snapshots for faster local loops.

## Profiling

Generate V8 profiler output:

```sh
pnpm run profile:scan:v8
```

This creates an `isolate-*.log` file. Convert it with Node's profiler tooling:

```sh
node --prof-process isolate-*.log > test/leak/profiles/v8-profile.txt
```

Run clinic.js doctor:

```sh
pnpm run profile:scan:clinic
```

The clinic command uses `pnpm dlx`, so it can download clinic when it is not installed locally.
Keep large raw profiler output out of git; commit only small summaries or representative HTML/PNG
when needed as profiling evidence.

## Interpreting Results

RSS is the resident set size: total memory held by the process. The harness computes a linear
regression slope in KB per scan iteration after dropping the first 10% of samples as warmup. A
stable scanner should have a near-flat RSS slope even if individual samples move up and down.

Heap snapshots are written with `v8.writeHeapSnapshot()`. Open them in Chrome DevTools Memory
panel and compare early versus late snapshots. Look for retained arrays, closures, listeners,
maps, timers, or worker resources that grow with iteration count.

Common scanner leak sources:

- Closures retaining announcement arrays or buffers after a scan completes.
- Event listener accumulation across scan calls.
- Unbounded browser or IndexedDB cache growth; the documented cap is 50 MB when that cache exists.
- Worker threads not terminating on success or error.
- Timers or unresolved promises keeping the event loop alive.
