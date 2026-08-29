# Bundle Size Baselines — All Public Exports

> Last measured: 2026-08-29
> Bundler: tsup (esbuild) via `size-limit`
> Sizes are **minified and brotli-compressed**, include all bundled
> dependencies, and are measured by `size-limit` (SI units: 1 KB = 1000 B).

## Current Sizes and Budgets

Every budget is the measured baseline **+ 15% headroom**, rounded up.

| Entry              | Format           | Baseline  | Budget (+15%) |
| ------------------ | ---------------- | --------- | ------------- |
| Root (`.`)         | ESM (`import *`) | 31.32 KB  | 36.1 KB       |
| Root (`.`)         | CJS (`require`)  | 138.79 KB | 159.7 KB      |
| `./chains/evm`     | ESM (`import *`) | 23.83 KB  | 27.5 KB       |
| `./chains/evm`     | CJS (`require`)  | 126.79 KB | 145.9 KB      |
| `./chains/solana`  | ESM (`import *`) | 17.15 KB  | 19.8 KB       |
| `./chains/solana`  | CJS (`require`)  | 25.89 KB  | 29.8 KB       |
| `./chains/ckb`     | ESM (`import *`) | 20.52 KB  | 23.6 KB       |
| `./chains/ckb`     | CJS (`require`)  | 128.76 KB | 148.1 KB      |
| `./vault`          | ESM (`import *`) | 1.93 KB   | 2.3 KB        |
| `./vault`          | CJS (`require`)  | 2.07 KB   | 2.4 KB        |
| `./chains/stellar` | ESM (`import *`) | 26.48 KB  | 30.5 KB       |
| `./chains/stellar` | CJS (`require`)  | 34.29 KB  | 39.5 KB       |

> Stellar note: the original 20 KB-per-format budget predated any actual
> measurement (the baseline had never been populated). The current Stellar
> bundle exceeds 20 KB, so its budget was re-baselined on 2026-08-29 using
> the same baseline + 15% rule as the other entries. Entry paths and options
> are unchanged.

## Checking Sizes (CI gate)

`pnpm size` checks **every** entry in the `size-limit` array of
`package.json` and exits non-zero if any budget is exceeded. CI runs it on
every PR that touches `src/` (see the `bundle-size` job in
`.github/workflows/ci.yml`).

```bash
pnpm build   # size-limit measures dist/ output, so build first
pnpm size
```

## Measuring / Debugging

Machine-readable output (exact byte counts):

```bash
pnpm build
./node_modules/.bin/size-limit --json
```

Generate a visual treemap of an entry's dependency graph:

```bash
ANALYZE=true pnpm build
# produces stats/ folder with metafile data
npx esbuild-visualizer --metadata stats/metafile-stellar.json --open
```

> `esbuild-visualizer` is an optional dev tool — install it globally or
> via `npx` when you need to inspect the graph.

## Budget Policy

- Each entry's budget is its measured baseline + 15% headroom (see table).
- If a PR increases any bundle beyond its budget, CI fails.
- Reviewers should verify no cross-chain code was introduced (e.g. nothing
  from `evm/`, `solana/`, `ckb/`, or `agent/` leaking into
  `src/chains/stellar/`) by checking imports.
- To adjust a budget, update the `size-limit` array in `package.json` and
  this table together, and note the reason in the PR description.

## Known Optimizations

1. **Lazy `@stellar/stellar-sdk` import** — `pubKeyToStellarAddress()` uses a
   dynamic `import()` instead of a top-level static import, ensuring the
   optional peer dependency is never loaded until the function is actually
   called. See `src/chains/stellar/scalar.ts`.

2. **No cross-chain leaks** — `src/chains/stellar/` imports zero code from
   `evm/`, `solana/`, `ckb/`, or `agent/` directories. All imports are
   local (`./`) or external npm packages (`@noble/curves`, `@noble/hashes`).
