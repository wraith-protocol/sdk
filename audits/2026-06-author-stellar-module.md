# Stellar Module Cryptographic Audit — Draft

Date: 2026-06-02
Author: (TBD)

Scope

- Review of `src/chains/stellar/` primitives: keys, scalar, stealth, scan, spend, announcements.

Status

- Baseline: repository tests all pass (136 tests).
- Dependencies pinned in `pnpm-lock.yaml`: `@noble/curves@1.9.7`, `@noble/hashes@1.8.0`.

Next steps

- Complete line-by-line review and produce findings with severity, repro tests, and recommendations.
- Collect ECDH test vectors and run cross-checks against a reference implementation.
- Coordinate disclosure for any Critical/High findings.

Findings

- (To be populated during review)

Findings

1. `signWithScalar` deviates from RFC8032 deterministic construction

- Description: `src/chains/stellar/scalar.ts::signWithScalar()` derives the
  nonce prefix as `sha256(scalarBytes)` and then computes `r = SHA-512(prefix || message) mod L`.
  RFC8032 specifies deterministic ed25519 signing using SHA-512 of the original 32-byte seed
  (not the scalar) to derive the prefix. Using the scalar-derived prefix is a protocol
  deviation that changes nonce derivation semantics and could have subtle implications
  if the same `stealthScalar` is used across different contexts.
- Severity: High
- Reproduction: See test `test/audits/stellar.test.ts` - skipped (High severity)
- Recommendation: Replace custom signing with an audited construction. Options:
  - Store and use the original 32-byte seed where possible and follow RFC8032.
  - If only the scalar is available, use a documented and reviewed deterministic
    signing construction (and justify why it meets the required properties).
  - At minimum, add comprehensive tests and a formal review of `signWithScalar`.

2. Zero `hashScalar` yields stealth = spending key (rare edge case)

- Description: If `hashToScalar(sharedSecret) == 0`, then `deriveStealthPubKey(spend, 0)`
  equals the original spending public key. An announcement with such a shared-secret
  would cause the stealth address to equal the recipient's spending address, breaking
  unlinkability for that payment.
- Severity: Medium (probability ~1/L, still worth noting)
- Reproduction: Unit test confirms `deriveStealthPubKey(spend, 0n) === spend`.
- Recommendation: Treat `hashScalar == 0` as an exceptional case: either
  - reject announcements where `hashScalar == 0` (scanner/recipient skip), or
  - document the risk and accept it as cryptographically negligible.

3. edwards->montgomery conversion and X25519 integration checks

- Description: `stealth.computeSharedSecret()` converts ed25519 keys to Montgomery form
  using `edwardsToMontgomeryPriv`/`edwardsToMontgomeryPub` and calls X25519.
  This code path must be validated against independent X25519/Ed25519 conversion
  expectations and test vectors.
- Severity: Medium
- Reproduction: Unit test verifies `computeSharedSecret(seedA, pubB)` equals
  `x25519.getSharedSecret(edwardsToMontgomeryPriv(seedA), edwardsToMontgomeryPub(pubB))`.
- Recommendation: Collect and store ECDH test vectors (both random and RFC vectors),
  add CI tests comparing Wraith's implementation against an independent reference
  (e.g., a different library or authoritative test vectors).

4. Domain separation prefixes present and versioned

- Description: The implementation uses explicit prefixes:
  - `wraith:spending:`, `wraith:viewing:` (key derivation)
  - `wraith:scalar:` (shared-secret -> scalar)
  - `wraith:stellar:view-tag:v2:` and legacy `wraith:tag:` (view-tag)
    These are versioned which is good practice.
- Severity: Low / Informational
- Reproduction: Unit test validates `computeAnnouncementViewTag()` uses the expected
  prefix by comparing the raw SHA-256 computation.
- Recommendation: Keep prefixes versioned; ensure any protocol docs include these exact
  strings. Consider centralizing prefix constants in one file to avoid discrepancies.

5. Dependency pinning (lockfile) — recommend exact pins in package.json

- Description: `package.json` uses caret ranges for `@noble/curves` and `@noble/hashes`,
  but `pnpm-lock.yaml` currently resolves to `@noble/curves@1.9.7`, `@noble/hashes@1.8.0`.
  For cryptographic stability prefer exact pins in `package.json` or CI checks that
  enforce lockfile changes require review.
- Severity: Low
- Reproduction: Unit test checks `pnpm-lock.yaml` contains the expected versions.
- Recommendation: Pin to exact versions or add an automated check that flags lockfile
  updates to these dependencies for manual review.

6. View-tag prefilter correctness and bias

- Description: The view-tag uses the first byte of `SHA-256(prefix || R || V)`.
  SHA-256 of this concatenation should be uniformly distributed across bytes; therefore
  the one-byte filter yields approximate 1/256 selection probability.
- Severity: Informational
- Reproduction: Unit test samples many ephemeral keys and asserts the view-tag set
  shows sufficient diversity (smoke test).
- Recommendation: Accept this filter; document the expected false-positive rate.

7. Constant-time / side-channel considerations

- Description: Implementation uses JS bigints and high-level libs; strict constant-time
  is not guaranteed. `noble-curves` implements many primitives carefully, but higher-level
  wrapping code (additions, mod reductions, custom signing) may not be constant-time.
- Severity: Informational
- Recommendation: Document threat model (JS environment) and mark constant-time as
  a soft goal. For high-value deployments consider native modules or audited constant-time
  implementations.
