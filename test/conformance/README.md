# Conformance Test Suite

This directory contains parameterized invariant tests that verify the correctness of cryptographic operations across different blockchain implementations.

## Overview

Conformance tests are property-based tests that run against thousands of generated test cases to ensure that public functions satisfy their contracts. These tests are:

- **Deterministic**: No network calls or external dependencies
- **Comprehensive**: Each invariant runs against 1000+ generated cases
- **Fast**: Designed to run quickly on every PR
- **Security-focused**: Failures should be filed as security issues (privately)

## Stellar Conformance Tests

The Stellar conformance test suite (`stellar.test.ts`) validates the stealth address implementation for the Stellar blockchain. It covers the following invariants:

### Key Derivation Invariants

1. **deriveStealthKeys produces valid ed25519 keypairs** - Validates that derived keys are 32 bytes, scalars are in range [0, L), and public keys are valid ed25519 points
2. **deriveStealthKeys is deterministic** - Ensures the same signature always produces identical keys
3. **deriveStealthKeys separates spending and viewing keys** - Confirms spending and viewing keys are cryptographically independent

### Stealth Address Generation Invariants

4. **generateStealthAddress produces valid Stellar addresses** - Validates output format (G...), ephemeral key length, and view tag range
5. **generateStealthAddress is deterministic with fixed seed** - Same inputs produce identical outputs
6. **generateStealthAddress produces different addresses for different inputs** - Different ephemeral seeds produce different addresses

### Meta-Address Invariants

7. **encode/decode meta-address round-trip** - Encoding and decoding preserves the original keys

### View Tag Invariants

8. **view-tag computation is deterministic** - Same inputs produce the same view tag
9. **view-tag is in valid range** - View tags are always in range [0, 255]

### Scanning Invariants

10. **checkStealthAddress correctly identifies matches** - Generated stealth addresses are correctly detected
11. **checkStealthAddress rejects non-matches** - Wrong viewing keys fail to match
12. **scanAnnouncements finds all matches** - Scanner correctly identifies matching announcements among decoys

### Private Key Derivation Invariants

13. **deriveStealthPrivateScalar produces valid scalar** - Derived scalars are in range [0, L) and differ from spending scalar
14. **deriveStealthPrivateScalar is deterministic** - Same inputs produce the same stealth scalar

### Signing Invariants

15. **signWithScalar produces valid signatures** - Signatures are 64 bytes and verify correctly
16. **signWithScalar is deterministic** - Same inputs produce the same signature

### Scalar Operations Invariants

17. **seedToScalar produces clamped scalars** - Validates ed25519 clamping bits are correctly applied
18. **hashToScalar produces values in range** - Hashed scalars are always < L
19. **deriveStealthPubKey produces valid ed25519 points** - Derived public keys are valid curve points
20. **pubKeyToStellarAddress produces valid addresses** - Public keys convert to valid Stellar addresses

### ECDH Invariants

21. **computeSharedSecret is symmetric** - ECDH produces the same shared secret for both parties
22. **computeSharedSecret produces 32-byte output** - Shared secrets are always 32 bytes

### Legacy Compatibility Invariants

23. **scanAnnouncementsLegacySharedSecretTag matches scanAnnouncements** - Legacy scanner produces identical results

### Transaction Signing Invariants

24. **signStellarTransaction wraps signWithScalar correctly** - Produces valid signatures that verify

### Uniqueness Invariants

25. **different recipients produce different stealth addresses** - Confirms low collision probability across many recipients

## Running the Tests

Run all conformance tests:

```bash
pnpm test test/conformance
```

Run only Stellar conformance tests:

```bash
pnpm test test/conformance/stellar.test.ts
```

## Test Configuration

The Stellar conformance suite uses the following test counts to balance coverage with execution time:

- **Standard tests**: 200 iterations (fast operations)
- **Slow tests**: 100 iterations (expensive operations like ECDH, scanning)
- **Global timeout**: 60 seconds per test

This configuration ensures the full suite completes in approximately 2 minutes while maintaining strong cryptographic coverage.

## CI Integration

These tests run automatically on every PR via the CI workflow (`.github/workflows/ci.yml`). The test suite is part of the standard `pnpm test` command.

## Security

Any failures in the conformance test suite should be treated as potential security vulnerabilities:

1. **File a private security issue** - Do not discuss publicly
2. **Include reproduction steps** - Provide the specific invariant that failed
3. **Attach test output** - Include the full error message and stack trace
4. **Assess impact** - Evaluate whether the invariant failure could lead to:
   - Key leakage
   - Unauthorized spending
   - Privacy violations
   - Denial of service

## Adding New Invariants

When adding new invariants:

1. Follow the naming convention: `Invariant [N]: [description]`
2. Run against at least 1000 test cases
3. Ensure the test is deterministic (no randomness in the assertion logic)
4. Use the helper functions (`randomSeed`, `randomSignature`, `randomBytes32`) for test data
5. Document the security property being validated
6. Update this README with the new invariant description

## Test Data Generation

The suite uses cryptographic randomness from `@noble/curves/ed25519` for test data generation:

- `randomSeed()` - Generates a random 32-byte seed
- `randomSignature()` - Generates a random 64-byte signature
- `randomBytes32()` - Generates a random 32-byte array

All functions use `ed25519.utils.randomPrivateKey()` which is cryptographically secure.
