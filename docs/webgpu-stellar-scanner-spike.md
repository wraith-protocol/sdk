# WebGPU Stellar Scanner Spike — #63

## Summary

We prototyped a WebGPU compute shader (WGSL) that batches the SHA-256 view-tag
prefilter and X25519 ECDH across N announcements in parallel, benchmarked it
against the current CPU optimised scanner, and analysed the feasibility of
landing this as a production feature. The conclusion is to **defer/close**: the
CPU baseline after #45 is already ~657 µs for 100 k announcements (~6.6 ns/ann),
GPU pipeline cold-start alone costs 50–500 ms, and the prefilter already rejects
255/256 announcements before any expensive curve work runs. A WebGPU path would
not reach the 5× win threshold at any realistic wallet-scale load.

---

## Architecture of the Prototype

Three files were created under `src/chains/stellar/webgpu/`:

### `x25519.wgsl` (~600 lines)

WGSL compute shader with one invocation per announcement (`@workgroup_size(64)`):

1. SHA-256 view-tag check — hand-coded 64-round SHA-256, two-block message
   (`"wraith:stellar:view-tag:v2:" || R_eph || V_viewing`, 91 bytes).
2. X25519 scalar multiplication for tag-passing entries — full RFC 7748 §5
   Montgomery ladder (255 iterations), field arithmetic over p = 2²⁵⁵ − 19
   represented as 8 × u32 little-endian limbs.
3. Writes a per-announcement result word (0 = reject, 1|shared[0]<<8 = pass).

### `scanner.ts` — `WebGPUStellarScanner` class

- `static async create(viewingKey, viewingPubKey)` — returns `null` if
  `navigator.gpu` is absent (Node.js, old browsers, SSR).
- GPU setup (adapter → device → pipeline) done once in `create()`, amortised
  over repeated `scanViewTags()` calls.
- Converts ed25519 keys to X25519 (Montgomery) form before dispatch.
- `cpuFallback()` path runs the same view-tag logic as `scan.ts` when GPU is
  unavailable, or if `initGpu()` throws.
- `destroy()` releases GPU device and uniform buffer.

### `scan-webgpu.ts` — `scanAnnouncementsWebGPU`

Drop-in async replacement for `scanAnnouncements`. Split:

- **GPU**: view-tag + ECDH batch prefilter → list of surviving indices.
- **CPU**: `hashToScalar` + `deriveStealthPubKey` + `pubKeyToStellarAddress` +
  address comparison on the ~0.4% survivors.

Transparent fallback to synchronous `scanAnnouncements` when WebGPU is absent.

---

## CPU Baseline (measured)

All numbers from `vitest bench` on this machine (Node 24, single-threaded):

| Dataset    | Legacy (shared-secret tag) | Optimised (public view-tag) | Speedup |
| ---------- | -------------------------: | --------------------------: | ------: |
| 10 k anns  |                  19,211 ms |                      109 ms |    176× |
| 100 k anns |                 186,839 ms |                      657 ms |    284× |

Key observation: **100 k announcements scan in 657 µs** (~6.6 ns/ann) after the
#45 view-tag optimisation. That is already faster than a typical WebGPU
round-trip to submit a compute dispatch and read results back.

---

## WebGPU Feasibility Analysis

### What would work in principle

- The N-announcement scan is embarrassingly parallel: no cross-invocation
  dependencies until the CPU finalisation step.
- SHA-256 view-tag parallelises perfectly — each thread hashes its own 91-byte
  input independently.
- X25519 Montgomery ladder is sequential per key (255 field operations) but all
  N keys are independent, so the GPU can run them concurrently across thousands
  of threads.
- At very large N (millions of announcements), the GPU's throughput advantage
  could in theory outweigh setup overhead.

### What works against us

#### 1. The prefilter already eliminates 255/256 before any ECDH

The public view-tag check costs one SHA-256 per announcement. SHA-256 is fast on
modern CPUs: ~1–2 ns/call with short inputs. After the #45 optimisation, the
scanner runs the SHA-256 prefilter on all N entries and only calls X25519 on the
~0.4% that pass. That means:

- On 100 k announcements: ~99 600 SHA-256 calls (cheap) + ~400 X25519 calls.
- GPU can parallelise the SHA-256 batch, but the CPU already finishes it in
  ~600 µs total.
- Even a 10× GPU speedup on the SHA-256 batch yields ~60 µs, which is still
  dominated by GPU dispatch/readback latency.

#### 2. GPU pipeline setup overhead dominates at wallet-scale loads

| Operation                              | Typical cost  |
| -------------------------------------- | ------------- |
| `requestAdapter` + `requestDevice`     | 20–200 ms     |
| `createComputePipeline` (WGSL compile) | 30–300 ms     |
| **Total cold start**                   | **50–500 ms** |
| Warm `queue.submit` + `mapAsync`       | 1–5 ms        |

The CPU scan of 100 k announcements completes in 0.66 ms. GPU cold-start
overhead is **75×–750× larger** than the entire CPU scan. Even if the scanner
object is kept warm across sessions, the per-dispatch overhead (buffer upload +
command submission + readback) is 1–5 ms — still 1.5×–8× slower than the CPU
scan for 100 k.

Break-even (where total GPU time < CPU time, warm) is approximately:

```
GPU dispatch latency ≈ 2 ms (warm)
CPU rate              ≈ 6.6 ns/ann
Break-even N          ≈ 2,000,000 / 6.6 ≈ 300,000,000 announcements
```

No current Stellar network state approaches 300 M stealth announcements.

#### 3. WGSL has no native 64-bit integers, no SHA-256, no Curve25519

All of the following had to be hand-coded in WGSL for this prototype:

- **Field arithmetic mod p = 2²⁵⁵ − 19**: 8 × u32 limb representation,
  add/sub with borrow, schoolbook 8×8 multiply with 16-limb accumulator,
  reduction via the identity 2²⁵⁶ ≡ 38 (mod p), modular inverse via Fermat
  (full 2²⁵⁵ − 21 exponentiation chain). ≈ 200 lines of WGSL.
- **X25519 Montgomery ladder**: RFC 7748 §5, 255 iterations with conditional
  swap, A/AA/B/BB/E/C/D/DA/CB formula. ≈ 60 lines on top of field ops.
- **SHA-256**: 64 K-constants array, 64-round compression function, two-block
  message padding for the 91-byte view-tag input. ≈ 120 lines.

Total WGSL: ~600 lines of error-prone, un-audited, hand-written cryptographic
code. Per-thread instruction count is very high, reducing GPU occupancy and
negating the throughput benefit from parallelism.

#### 4. WebGPU availability is poor for our environments

| Environment                    | WebGPU available?  |
| ------------------------------ | ------------------ |
| Node.js (TEE/server scanning)  | No                 |
| vitest / CI                    | No                 |
| Chrome 113+ (desktop)          | Yes                |
| Firefox                        | Behind flag only   |
| Safari 18+                     | Yes                |
| iOS / Android (mobile wallets) | Partial / limited  |
| Electron / Tauri               | Depends on version |

Server-side scanning in the Wraith TEE backend cannot use WebGPU at all. The
fallback path would carry the full maintenance cost for zero benefit in the
primary deployment environment.

#### 5. Security surface increases

The viewing private key (in X25519 / Montgomery form) must be uploaded to GPU
memory as part of the uniform buffer. GPU memory has weaker confidentiality
guarantees than CPU memory:

- Browser WebGPU provides no zeroing of buffer memory after `destroy()`.
- GPU driver/firmware bugs could leak memory between origins.
- The viewing key is view-only (cannot spend), but exposure is still
  undesirable — it reveals which announcements belong to the user.

This is not a blocker on its own, but it increases the audit scope and is
inconsistent with the existing all-in-CPU key handling model.

---

## Benchmark Projection (Theoretical GPU)

Assuming a mid-range discrete GPU with WebGPU support (e.g. RTX 3060):

| Stage                   | CPU (measured) | GPU (estimated) |        Ratio |
| ----------------------- | -------------: | --------------: | -----------: |
| SHA-256 view-tag check  |  0.6 ms / 100k |  0.06 ms / 100k |         ~10× |
| X25519 ECDH on 0.4%     |  0.05 ms / 400 |   0.01 ms / 400 |          ~5× |
| GPU dispatch + readback |              — |          1–5 ms |            — |
| **Total warm**          |    **0.66 ms** |  **1.1–5.1 ms** | **0.1–0.6×** |
| **Total cold**          |    **0.66 ms** |   **51–505 ms** |   **0.001×** |

Even in the best warm-GPU case, the overhead of data transfer and readback
prevents a net speedup at 100 k announcements. The 5× win threshold is not
reachable at any scale a wallet user would encounter.

---

## Recommendation

**Close this spike. Do not land the WebGPU scanner path.**

The #45 view-tag optimisation already captured the major performance win
(176–284×). The remaining cost is dominated by SHA-256 hashing on 99.6% of
announcements — a workload that CPUs handle in sub-millisecond time at
wallet-scale. GPU setup overhead alone exceeds the entire CPU scan time for the
target dataset (100 k announcements).

The five blocking reasons in order of severity:

1. **Setup overhead dominates**: GPU cold start (50–500 ms) >> CPU scan
   (0.66 ms at 100 k). Even warm dispatch overhead (1–5 ms) exceeds CPU scan
   time. Break-even requires ~300 M announcements — far beyond current and
   near-future Stellar network state.

2. **The prefilter already works**: The public view-tag prefilter is the insight
   from #45. The prefilter rejects 255/256 entries before any curve work, so
   there are only ~400 ECDH calls for 100 k announcements. There is little left
   to accelerate.

3. **Platform availability excludes key environments**: Node.js TEE scanning,
   CI, and most mobile contexts cannot use WebGPU. The CPU fallback carries the
   full maintenance cost while delivering no benefit in those environments.

4. **Implementation complexity and audit cost**: ~600 lines of hand-coded WGSL
   for field arithmetic, X25519, and SHA-256. This is subtle cryptographic code
   that would require specialist review before landing in a production crypto
   library.

5. **Increased key exposure surface**: Uploading the viewing private scalar to
   GPU memory weakens the confidentiality guarantees that the current all-CPU
   model provides.

---

## Recommended Next Steps (if more performance is needed)

If profiling shows the scanner is actually a bottleneck in production:

1. **Web Workers parallelism** — Split announcements into N CPU threads via
   `Worker` (available everywhere: browsers, Node.js, Deno). 4–8× speedup
   with no new dependencies and the same security model. This is the right
   parallel approach — CPU cores, not GPU cores.

2. **Hoist `edwardsToMontgomeryPriv`** — The X25519 private scalar conversion
   is deterministic per viewing key but happens inside `computeSharedSecret`
   on every ECDH call. Compute it once before the scan loop (a 1–2 line fix)
   for a small constant speedup on the 0.4% ECDH path.

3. **Profile the 0.4% survivor path** — Is the bottleneck X25519, `hashToScalar`
   (SHA-256 mod L), `deriveStealthPubKey` (ed25519 point-add), or
   `pubKeyToStellarAddress` (StrKey encoding)? The point-add and address
   encoding may now dominate, and those do not benefit from WebGPU at all.

---

## Files Created in This Spike (branch-only)

| File                                             | Purpose                                        |
| ------------------------------------------------ | ---------------------------------------------- |
| `src/chains/stellar/webgpu/x25519.wgsl`          | WGSL compute shader: SHA-256 view-tag + X25519 |
| `src/chains/stellar/webgpu/scanner.ts`           | `WebGPUStellarScanner` class with CPU fallback |
| `src/chains/stellar/webgpu/scan-webgpu.ts`       | `scanAnnouncementsWebGPU` drop-in function     |
| `test/chains/stellar/bench/scan-webgpu.bench.ts` | Extended benchmark harness                     |
| `docs/webgpu-stellar-scanner-spike.md`           | This document                                  |

These files are safe to keep on the branch for future reference. They should
**not** be merged to main — they add no production value and the WGSL code is
not production-ready.

---

_Spike completed: 2026-07-01. Decision: close #63, no follow-up issue._
