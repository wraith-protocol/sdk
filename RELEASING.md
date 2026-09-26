# Releasing the SDK

This is the checklist for cutting a release of `@wraith-protocol/sdk`. It exists
because four things have to agree before a version goes to npm — the version, the
changelog, the API report, and the tarball contents — and three of them are
enforced by CI so they cannot be skipped by accident.

Publishing is automated: `.github/workflows/publish.yml` runs on every push to
`main` that touches `package.json`, builds, tests, verifies, and publishes with
provenance if the version is not already on the registry. The checklist below is
what must be true in the commit you push.

## Before you bump

- [ ] `main` is green, including the **Pack + release alignment** job.
- [ ] `pnpm install --frozen-lockfile && pnpm build && pnpm test` passes locally.
- [ ] `pnpm api:check` passes. If the public API changed, the refreshed
      `etc/*.api.md` reports are part of this release commit, not a follow-up —
      `pnpm release:check` fails if a configured report is missing.

## 1. Version

- [ ] Decide the bump (semver: breaking → major, additive → minor, fixes → patch).
      `MIGRATING.md` documents the breaking-change process and must be updated for
      a major.
- [ ] Run `pnpm version <major|minor|patch> --no-git-tag-version` (or edit
      `package.json` directly) so the `version` field is the version you are
      publishing.
- [ ] Confirm the version is not already on the registry:

      ```bash
      npm view @wraith-protocol/sdk@<version> version   # should print nothing
      ```

  The publish workflow performs the same check and skips publishing if the
  version exists, so a repeated push is harmless but also does nothing.

## 2. Changelog

- [ ] `pnpm release:check` reports no warning about the version you are
      releasing. It warns when `package.json` names a version with no
      corresponding `## [<version>]` heading.
- [ ] In `CHANGELOG.md`, move the relevant entries out of `## Upcoming: <version>`
      into a released heading:

      ```markdown
      ## [1.6.0] - 2026-09-25
      ```

- [ ] Every user-visible change is listed, and breaking changes say so
      explicitly, with a `MIGRATING.md` link.
- [ ] Reference issue numbers the way the existing entries do
      (`(issue #210)`), so the release notes stay traceable.

The `release` job in CI enforces the structure: a released heading must exist, and
a version in `package.json` with no heading is reported as a warning on every PR
so it is visible long before the release.

## 3. API report alignment

- [ ] `etc/sdk.api.md` plus the chain-specific reports (`sdk-ckb`, `sdk-evm`,
      `sdk-solana`, `sdk-stellar`, `sdk-vault`) are committed and current.
- [ ] `pnpm api:check` is clean against the built `dist/` — `release:check`
      confirms a report exists for every `api-extractor*.json` configuration, and
      the CI `test` job runs `api:check` itself.
- [ ] If you added or removed an entry point, the corresponding
      `api-extractor-*.json` and report are both in the commit.

A report that exists but is stale is still caught: `api:check` compares the
report against the freshly built declarations and fails the build on a mismatch.

## 4. Pack contents

- [ ] `pnpm pack:check` passes. It runs the real `pnpm pack --dry-run` and fails
      if anything outside `dist/` (plus the files npm always includes:
      `package.json`, `README`, `LICENSE`, `CHANGELOG`) would ship — source,
      tests, `docs/`, `scripts/`, `etc/` API reports, `api-extractor*.json`,
      lockfiles or CI config.
- [ ] If the package layout intentionally changed, update `files` in
      `package.json` and the allowlist in `scripts/verify-pack.mjs` in the same
      commit, and say why in the PR.
- [ ] To see the list locally:

      ```bash
      pnpm build && pnpm pack:check
      ```

## 5. Publish

Push the release commit to `main`. The workflow then:

1. installs, builds and tests;
2. runs `pnpm release:check` (version/changelog/API report alignment);
3. runs `pnpm pack:check` (packed file list);
4. checks the registry and skips if the version already exists;
5. publishes with `pnpm publish --access public --no-git-checks --provenance`;
6. runs `node scripts/verify-provenance.mjs`, which reads the registry metadata
   back and fails the run if no attestation was attached.

## 6. After publishing

- [ ] Confirm the run's **Verify the provenance attestation** step reported a
      predicate type and URL. `--provenance` silently doing nothing (a dropped
      `id-token: write`, a private repo) is exactly what that step catches.
- [ ] Confirm the attestation on the registry:

      ```bash
      npm view @wraith-protocol/sdk@<version> dist.attestations --json
      ```

- [ ] Spot-check the published tarball matches the local pack list:

      ```bash
      npm view @wraith-protocol/sdk@<version> dist.tarball
      ```
- [ ] Open the `## Upcoming` section again for the next cycle, and revert this
      checklist mentally to "before you bump".

## If something is wrong after publish

npm does not allow re-using a version number, so a broken release is fixed
forward, never by republishing the same version.

1. `npm deprecate '@wraith-protocol/sdk@<version>' "<reason and the fixed version>"`.
2. If the tarball is unusable, `npm unpublish '@wraith-protocol/sdk@<version>'`
   within the registry's 72-hour window, then release again with an incremented
   version. Prefer deprecation — unpublishing breaks every lockfile pinned to it.
3. Add the postmortem to the changelog entry for the fixing release.
