# Stellar view-tag batching design

## Problem

The original Stellar scan path computed `S = X25519(v, R_ephemeral)` for every announcement before checking the view tag. That made the one-byte view tag a correctness filter, but not a performance filter: non-matching announcements still paid the dominant ECDH cost.

## Chosen design

New Stellar announcements derive the first metadata byte from public announcement data:

```text
view_tag = SHA-256("wraith:stellar:view-tag:v2:" || R_ephemeral || V_recipient)[0]
```

Where:

- `R_ephemeral` is the 32-byte ed25519 ephemeral public key included in the announcement.
- `V_recipient` is the recipient's 32-byte ed25519 viewing public key from the meta-address.

This keeps the stealth-address secret scalar unchanged:

```text
S = X25519(r_ephemeral, V_recipient) = X25519(v_recipient, R_ephemeral)
hash_scalar = SHA-256("wraith:scalar:" || S) mod L
P_stealth = K_spend + hash_scalar * G
```

Scanners now derive `V_recipient` once from the local viewing seed, hash `R_ephemeral || V_recipient` for every announcement, and only compute X25519 plus ed25519 point addition for the roughly 1/256 announcements whose tag matches.

## Tradeoffs

### Benefits

- The hot scan loop replaces nearly all X25519 operations with one SHA-256 over a small public tuple.
- The full stealth address derivation and private scalar derivation remain unchanged for matching announcements.
- The filter keeps the same one-byte false-positive rate as the previous shared-secret tag.
- Invalid 32-byte ephemeral keys are only parsed as curve points after the public tag passes; if a crafted candidate passes the tag but is not a valid point, it is skipped.

### Costs and compatibility

- The view tag is no longer bound to the ECDH shared secret. It is a public prefilter, not authentication. This is acceptable because the announced stealth address is still verified with the shared-secret-derived scalar before a match is returned.
- A sender that knows a recipient's public viewing key can deliberately choose metadata that passes the recipient's public prefilter. That only causes the recipient to do the same full verification they already needed for candidate announcements, and the stealth address check still prevents false matches.
- Legacy announcements whose metadata used `SHA-256("wraith:tag:" || S)[0]` are not compatible with the optimized `scanAnnouncements` path. The SDK retains `scanAnnouncementsLegacySharedSecretTag` for benchmarks and migration tooling, but using it for normal scans necessarily reintroduces one X25519 per announcement.
- If deployed contracts or indexers need to distinguish old and new metadata semantics, this should be represented as a soft fork/new scheme identifier. The SDK-side cryptographic change is isolated to metadata generation and scanning; the stealth-address math does not change.

## Benchmarks

The benchmark harness lives at `test/chains/stellar/bench/scan.bench.ts` and compares:

1. `scanAnnouncementsLegacySharedSecretTag` over legacy shared-secret-tag announcements.
2. `scanAnnouncements` over new public-announcement-tag announcements.

Run it with:

```bash
pnpm exec vitest bench test/chains/stellar/bench/scan.bench.ts --run
```

The harness covers synthetic 10k, 100k, and 1M announcement datasets with one recipient match and a large pool of foreign announcements. Set `STELLAR_SCAN_BENCH_SIZES=10000` (or a comma-separated list) to run a subset locally.

On this development container, the 10k benchmark reported:

| Dataset              | Before: shared-secret tag | After: public prefilter | Speedup |
| -------------------- | ------------------------: | ----------------------: | ------: |
| 10,000 announcements |              31,310.03 ms |                98.83 ms | 316.80x |

The expected speedup grows with dataset size because the optimized path computes the viewing public key once and performs X25519 only for public view-tag hits instead of every same-scheme announcement.
