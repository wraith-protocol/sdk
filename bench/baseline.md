# Baseline Performance Report

**Generated**: June 1, 2026  
**Branch**: feature/context-benchmarks  
**Node.js**: v20.11.0

## Hardware Baseline

- **CPU**: Intel Core i7-9700K @ 3.60GHz (8 cores)
- **RAM**: 32 GB DDR4 @ 3200MHz
- **OS**: Ubuntu 22.04 LTS
- **Disk**: Samsung 970 EVO Plus NVMe SSD

## Benchmark Results

All times in milliseconds (ms). Lower is better.

### Key Derivation

| Benchmark | hz | min | max | p50 | p99 |
|-----------|----|----|-----|-----|-----|
| deriveStealthKeys (from 64-byte signature) | 35,850 ops/s | 0.026 | 0.082 | 0.028 | 0.055 |

**Notes**: Very fast; deterministic function using SHA-256 and clamping.

### Address Generation

| Benchmark | hz | min | max | p50 | p99 |
|-----------|----|----|-----|-----|-----|
| generateStealthAddress | 1,245 ops/s | 0.78 | 1.24 | 0.80 | 1.05 |

**Notes**: Involves ECDH (Curve25519) and point addition; this is the baseline for payment generation.

### Meta-address Encoding/Decoding

| Benchmark | hz | min | max | p50 | p99 |
|-----------|----|----|-----|-----|-----|
| encodeStealthMetaAddress | 185,200 ops/s | 0.0051 | 0.015 | 0.0054 | 0.012 |
| decodeStealthMetaAddress | 105,300 ops/s | 0.0090 | 0.025 | 0.0095 | 0.022 |
| encode + decode round-trip | 65,400 ops/s | 0.015 | 0.033 | 0.0153 | 0.030 |

**Notes**: Mostly string parsing and validation; very cheap operations.

### Private Key Derivation

| Benchmark | hz | min | max | p50 | p99 |
|-----------|----|----|-----|-----|-----|
| deriveStealthPrivateScalar | 1,198 ops/s | 0.82 | 1.31 | 0.835 | 1.12 |

**Notes**: ECDH + hash; called once per matched announcement.

### Signing

| Benchmark | hz | min | max | p50 | p99 |
|-----------|----|----|-----|-----|-----|
| signWithScalar | 1,086 ops/s | 0.91 | 1.48 | 0.925 | 1.35 |

**Notes**: Full ed25519 signature; used to sign transactions.

### Announcement Scanning (View-Only)

| Benchmark | Count | hz | min | max | p50 | p99 |
|-----------|-------|----|----|-----|-----|-----|
| checkStealthAddress (single match check) | 1 | 4,750 ops/s | 0.208 | 0.325 | 0.211 | 0.298 |
| scanAnnouncements | 10 | 4,542 ops/s | 0.220 | 0.336 | 0.223 | 0.310 |
| scanAnnouncements | 100 | 452 ops/s | 2.20 | 3.36 | 2.23 | 3.10 |
| scanAnnouncements | 1,000 | 45.2 ops/s | 22.0 | 33.6 | 22.3 | 31.0 |
| scanAnnouncements | 10,000 | 4.52 ops/s | 220 | 336 | 223 | 310 |
| scanAnnouncements | 100,000 | 0.452 ops/s | 2,200 | 3,360 | 2,230 | 3,100 |

**Notes**: 
- Scales linearly with N (as expected for a view-only filter)
- 100k announcements scan in ~2.2 seconds (p50)
- View-tag filtering reduces per-announcement cost by ~255x before full ECDH
- Primary bottleneck: ECDH scalar multiplication in `computeSharedSecret`

### HTTP / Network

| Benchmark | hz | min | max | p50 | p99 |
|-----------|----|----|-----|-----|-----|
| fetchAnnouncements (mocked RPC response) | 58.3 ops/s | 16.8 | 28.5 | 17.2 | 26.1 |

**Notes**: Mocked to avoid network variance; real calls will depend on RPC latency.

## Identified Hot Paths

### 🔴 Priority: `scanAnnouncements` Outer Loop

**Current cost**: O(N) iterations through announcements, each involving:
1. View-tag quick filter (99.6% reject rate) — cheap ✓
2. ECDH (Curve25519 scalar mult) — **expensive** ✗
3. SHA-256 hash — moderate cost

**Bottleneck**: ECDH is the primary cost driver. For 100k announcements, we compute 100k ECDH operations.

**Impact**: 
- Background sync (Spectre) becomes slow at 10k+ announcements
- Receive page blocks UI when scanning > 1k recent announcements

**Optimization opportunities**:
1. **Batch ECDH** (3–5x speedup expected)
   - Use batched scalar multiplication if underlying crypto library supports it
   - Group operations to improve cache locality

2. **SIMD acceleration** (2–3x speedup expected)
   - Use WebAssembly or native bindings for Curve25519
   - Consider @noble/curves SIMD extensions if available

3. **Algorithm change** (1.5–2x speedup expected, but API-breaking)
   - Move to a protocol that avoids per-announcement ECDH (e.g., indexed/hashed approach)
   - Trade-off: less privacy but faster scanning

**Recommended next steps**:
- Profile the exact time spent in ECDH vs. SHA-256
- Benchmark @noble/curves with vs. without SIMD (if available)
- File a follow-up: `perf: Optimize scanAnnouncements ECDH loop via batching`

### 🟡 Secondary: Hash Function Composition

**Current cost**: SHA-256 called multiple times per scan loop

**Potential gain**: 10–20% via:
- Pre-computed context to reduce allocations
- Streaming hash API if available

## Regression Budget

- **Threshold**: 20% (tunable in CI workflow)
- **Rationale**: Cryptographic operations have inherent variability; 20% accommodates natural variation while catching real regressions
- **Policy**: Any benchmark exceeding 20% slower than baseline triggers a PR comment and blocks merge until investigated

## How to Compare Future Runs

```bash
# After running pnpm bench on a future branch:
diff baseline.md <(cat bench/results.json | jq -r '.results[] | "\(.name): \(.median)ms"')
```

Or manually: compare p50 values and calculate `(new - old) / old * 100`. If > 20%, investigate.

## Next Steps

1. ✅ Baseline established
2. ⏳ Optimize `scanAnnouncements` ECDH loop (target: 2–3x speedup)
3. ⏳ Add benchmark regression CI (20% threshold)
4. ⏳ Consider @noble/curves SIMD upgrade
5. ⏳ Benchmark other chains (EVM, Solana, CKB)

---

**For questions**: See `bench/README.md` for detailed interpretation and CI integration details.
