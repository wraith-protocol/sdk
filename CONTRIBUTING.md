# Contributing to `@wraith-protocol/sdk`

This guide defines the compatibility, deprecation, release, and pull request rules for the SDK. The package exposes cryptographic chain modules, so contributors should treat API shape, exported types, package entry points, and cryptographic behavior as part of the public contract.

## Semver Policy

Use semantic versioning for every release:

- **Major** versions are for breaking changes that require users to change code, data assumptions, or deployment configuration.
- **Minor** versions are for backward-compatible features, new chain support, and additive exports.
- **Patch** versions are for backward-compatible fixes, documentation corrections, and internal-only changes.

| Change                                    | Version bump   | Examples                                                                                                                                                                                           |
| ----------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| New chain module                          | Minor          | Adding `@wraith-protocol/sdk/chains/hedera` is minor because existing imports keep working. Adding `chains/stellar` helpers while preserving current Stellar exports is also minor.                |
| New function exported from a chain module | Minor          | Exporting `validateMetaAddress()` from `chains/stellar` is minor. Exporting `buildAnnouncementMemo()` from `chains/evm` is minor.                                                                  |
| Function signature changed                | Major          | Changing `scanAnnouncements(announcements, viewingKey, spendingPubKey, spendingKey)` to accept one options object is major. Changing `generateStealthAddress()` to return renamed fields is major. |
| Function removed                          | Major          | Removing `deriveStealthPrivateKey()` from EVM is major. Removing `decodeStealthMetaAddress()` from any chain module is major.                                                                      |
| Crypto behavior changed                   | Major          | Changing a domain-separation prefix is major. Changing the view-tag derivation scheme is major.                                                                                                    |
| Type tightened                            | Major          | Changing `string` to `` `0x${string}` `` for an accepted user input is major. Changing `Uint8Array` input to a fixed-length branded type is major unless the previous type still works.            |
| Type loosened                             | Minor          | Accepting `ReadonlyArray<Announcement>` where `Announcement[]` worked before is minor. Accepting `HexString                                                                                        | Uint8Array` is minor if existing callers still type-check. |
| Bundler config or `exports` changed       | Major or patch | Removing a package subpath from `exports` is major. Adding a missing CommonJS condition for an existing subpath is patch if no import path changes.                                                |
| Dependency major bumped                   | Major or minor | Bumping `@noble/curves` from 1 to 2 is major if it changes public types or runtime support. It can be minor if the SDK API and supported runtimes are unchanged.                                   |
| Default network or RPC URL changed        | Major or minor | Changing a default from mainnet to testnet is major. Rotating to an equivalent healthy RPC endpoint is minor if behavior is unchanged.                                                             |
| Bug fix that changes buggy behavior       | Patch or major | Fixing an invalid checksum calculation is patch if it makes documented behavior work. Changing accepted malformed meta-addresses to throw is major if users may rely on parsing them.              |

When a change is ambiguous, choose the larger bump and document why in the changelog.

## Deprecation Policy

Deprecated exports remain available for one major version after the replacement ships.

- Mark deprecated symbols with `@deprecated` JSDoc that names the replacement and target removal version.
- Emit a runtime warning from deprecated functions when they are called. Avoid warnings merely from importing a module, because that can surprise bundlers and tests.
- Document every deprecation in `CHANGELOG.md`.
- Add migration steps to `MIGRATING.md` when the replacement requires more than a one-line import change.

Examples:

- If `deriveStealthPrivateScalar()` is replaced by `deriveStealthPrivateKeyMaterial()` in `1.5.0`, keep the old export through all `1.x` releases and remove it in `2.0.0`.
- If `encodeStealthMetaAddress(pubA, pubB)` gains a clearer `encodeStealthMetaAddress({ spendingPubKey, viewingPubKey })` replacement, ship the object form first, mark the positional overload deprecated, and add a migration note before removing it in the next major.

## Release Process

Only maintainers with npm access may publish `@wraith-protocol/sdk`. Contributors prepare release-ready changes, but maintainers own version bumps, tags, and publication.

Pre-publish checklist:

1. Run `pnpm test`.
2. Run `pnpm build`.
3. Run `pnpm format:check`.
4. Update the version according to the semver policy.
5. Update `CHANGELOG.md`.
6. Check bundle output for every exported entry point.
7. Tag the release as `vX.Y.Z`.
8. Publish to npm.

Release cadence target:

- Patch releases: every two weeks when fixes are queued.
- Minor releases: monthly when additive features are ready.
- Major releases: quarterly at most, unless a security or cryptography correctness issue requires faster action.

Examples:

- A patch release that fixes Stellar transaction signing should run the Stellar tests, update `CHANGELOG.md`, tag `v1.4.6`, and publish after review.
- A minor release adding a Solana helper should include tests, docs, an additive changelog entry, tag `v1.5.0`, and verify the `./chains/solana` export in the built package.

## Pull Request Conventions

Use Conventional Commits for PR titles and commit messages where practical:

- `feat(stellar): add payment memo helper`
- `fix(evm): reject malformed stealth meta-address checksums`
- `docs: document semver policy`

Prefer squash merging so each PR becomes one coherent commit on `main`. Maintainers may use a merge commit for long-running branches when preserving branch history is useful.

Required review:

- At least one maintainer review for docs, examples, and non-crypto internal changes.
- At least two maintainer reviews for cryptography, key derivation, package exports, or cross-chain conformance changes.

Examples:

- A README typo can be a `docs:` PR with one maintainer review and no release note unless it changes user-visible setup instructions.
- A change to `scanAnnouncements()` should include tests, a semver note in the PR body, and two maintainers because it affects recipient fund discovery.

## Adding a New Chain

A new chain module should match the same shape as the existing EVM, Stellar, Solana, and CKB modules.

Checklist:

1. Implement the conformance contract described in issue [#8](https://github.com/wraith-protocol/sdk/issues/8).
2. Add `src/chains/<chain>/index.ts` with the public exports.
3. Add key derivation, meta-address encoding/decoding, stealth address generation, scan, and spend helpers where the chain model supports them.
4. Add unit tests and at least one end-to-end-style test matching the existing `test/chains/*` structure.
5. Add examples under `examples/<chain>/`.
6. Add the chain to the package build and `exports` matrix.
7. Document the new entry point in `README.md`.

Examples:

- Adding `chains/hedera` should include `src/chains/hedera/*`, tests under `test/chains/hedera`, examples under `examples/hedera`, and a README entry point table row.
- Adding a chain that cannot support private spend derivation should still expose the compatible parts of the conformance contract and document the unsupported operations explicitly.
