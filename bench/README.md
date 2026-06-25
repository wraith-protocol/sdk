# Stealth Address Benchmarks

This directory contains performance benchmarks for the Wraith Protocol SDK's stealth address implementations.

## Quick Start

```bash
# Run all benchmarks and save results
pnpm bench

# Run benchmarks in watch mode (re-run on file changes)
pnpm bench:watch

# Run benchmarks for a specific chain
pnpm bench -- --include="test/chains/stellar/**"
```

## Hardware Baseline

The baseline numbers in `baseline.md` were measured on:

- **CPU**: Intel Core i7-9700K @ 3.60GHz (8 cores, no hyperthreading)
- **RAM**: 32 GB DDR4 @ 3200MHz
- **OS**: Ubuntu 22.04 LTS
- **Node.js**: v20.11.0
- **Date**: May 31, 2026

## Interpreting Results

Each benchmark reports:
- **hz**: Operations per second (higher is better)
- **min**: Minimum execution time (ms)
- **max**: Maximum execution time (ms)
- **p50**: Median execution time (ms) — the 50th percentile
- **p99**: 99th percentile execution time (ms) — rare slow cases

Example output:
```
scanAnnouncements - 1,000 announcements
  hz          min        max        p50        p99
  45.2 ops/s  22.1 ms    24.5 ms    22.3 ms    24.1 ms
```

This means:
- We can scan 1,000 announcements **45.2 times per second**
- Typical scan takes **22.3 ms**
- 1 in 100 scans takes longer than **24.1 ms**

### Key Metrics

1. **Single-operation benchmarks** (e.g., `deriveStealthKeys`, `generateStealthAddress`)
   - Should be sub-millisecond (< 1 ms)
   - These are the building blocks and directly affect UI responsiveness

2. **Announcement scanning** (e.g., `scanAnnouncements` with N=10k)
   - Linear in N (doubling N should roughly double time)
   - The bottleneck for background sync and receive page performance
   - View-tag filtering reduces median cost by ~255x before full ECDH

3. **Signing operations** (e.g., `signWithScalar`, `signStellarTransaction`)
   - Hash function-bound; should be consistent and deterministic

## Comparing Against Previous Runs

### Automated: Via Benchmark Results File

```bash
# After running benchmarks, results are saved to bench/results.json
# Compare with a previous baseline:
diff <(jq '.results[] | {name: .name, hz: .hz}' bench/results.json) \
     <(jq '.results[] | {name: .name, hz: .hz}' bench/results-baseline.json)
```

### Manual: Via Baseline Report

1. Record the p50 value from the new run (e.g., 22.3 ms for 1k announcements)
2. Compare against `baseline.md` (e.g., previous was 21.5 ms)
3. Calculate the regression: `(22.3 - 21.5) / 21.5 * 100 = 3.7%`
4. If > 20%, file a regression issue and investigate

### Regression Budget

We use a **20% regression threshold** in CI. This means:
- If a benchmark gets 20% slower, it will be flagged for review
- Small regressions (< 20%) are acceptable and expected as features evolve
- Threshold is tunable in `.github/workflows/benchmark.yml`

## Understanding Scale Effects

Announcement scanning is the primary performance concern. We benchmark at multiple scales:

| Scale | Purpose |
|-------|---------|
| 10 | Minimum useful scan (e.g., last block's transactions) |
| 100 | Typical daily inbox |
| 1,000 | Weekly backlog |
| 10,000 | Monthly backlog |
| 100,000 | Full network sync or stress test |

**Expected behavior**: Time should grow linearly with N. If time grows faster (quadratic), it suggests a fixable algorithm bottleneck.

## Common Slowdowns

### Hot Path: `scanAnnouncements` Outer Loop

The scanning function:
1. Iterates through all N announcements (O(N))
2. For each announcement, computes ECDH (Curve25519 scalar mult) — **expensive**
3. Filters by view-tag first (eliminates ~99.6% of announcements) — **cheap**

**Issue**: Even with view-tag filtering, ECDH is repeated 1,000+ times. 

**Optimization opportunity**: Batch ECDH operations or use a more cache-friendly implementation.

**Expected speedup**: 2–3x via SIMD or hardware acceleration; 1.5–2x via algorithm tuning.

### Secondary: Hash Function Composition

Each announcement scan computes:
- SHA-256("wraith:scalar:" || shared_secret) — called many times
- Could benefit from streaming or pre-computed context

**Expected speedup**: 10–20% via reduction in allocations.

## Adding New Benchmarks

1. Add your benchmark function to `test/chains/<chain>/bench/<chain>.bench.ts`
2. Use the `bench()` function from `vitest` with a descriptive name
3. Ensure fixtures are outside the benchmark to avoid timing overhead
4. Run `pnpm bench` and add results to `baseline.md`

Example:
```typescript
bench('newFunction() on 1MB input', () => {
  const input = generateLargeInput(1024 * 1024);
  newFunction(input);
});
```

## CI Integration

Every PR runs benchmarks and compares against main. If any benchmark regresses > 20%, a comment is posted to the PR with:
- Which benchmarks regressed
- By how much (%)
- Link to the regression tracking issue

See `.github/workflows/benchmark.yml` for details.
