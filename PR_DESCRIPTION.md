# docs: add CONTRIBUTING.md with semver, deprecation, and release policies

Closes #12.

## What

- `CONTRIBUTING.md` — semver policy (11 categorised change types with before/after diffs),
  deprecation lifecycle, release process & cadence, PR conventions, and a rubric + two worked
  examples for adding a new chain.
- `MIGRATING.md` — scaffold linked from the deprecation policy; ready for the first `1.x → 2.x`
  entry.
- `README.md` — new **Contributing** section linking to both files (satisfies the "linked from
  the README" acceptance criterion).

## Acceptance criteria (issue #12)

- [x] `CONTRIBUTING.md` committed.
- [x] Linked from the README.
- [x] At least two examples in every section — rules are paired with concrete `diff` snippets,
      not just stated.

## Notes

- No code changes. `pnpm build` and `pnpm test` (134 tests) both pass locally.
- `pnpm format:check` flags ~105 pre-existing CRLF files unrelated to this PR; the three files
  touched here (`CONTRIBUTING.md`, `MIGRATING.md`, `README.md`) all pass prettier individually.
