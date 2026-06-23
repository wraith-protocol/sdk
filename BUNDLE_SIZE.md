# Bundle Size Baseline — Stellar Entry

> Last measured: 2026-06-23
> Bundler: tsup (esbuild) via `size-limit`

## Current Size

| Format | Size (gzip) | Budget |
|--------|-------------|--------|
| ESM (`import *`) | TBD | 20 KB |
| CJS (`require`) | TBD | 20 KB |

> TBD — run `pnpm build && pnpm size` after installation to populate
> actual measurements, then update this table.

## Dependency Graph

Generate a visual treemap of the Stellar entry's dependency graph:

```bash
ANALYZE=true pnpm build
# produces stats/ folder with metafile data
npx esbuild-visualizer --metadata stats/metafile-stellar.json --open
```

> `esbuild-visualizer` is an optional dev tool — install it globally or
> via `npx` when you need to inspect the graph.

## Measurement Commands

### esbuild (tsup) — via size-limit (CI gate)

```bash
pnpm build
pnpm size
```

### Vite-style bundling — standalone esbuild

```bash
pnpm measure:vite
```

Output written to `stats/vite-measurement.json`.

## Budget Policy

The Stellar entry budget is **20 KB gzipped** for each format (ESM, CJS).

- If a PR increases the Stellar bundle beyond the budget, CI will fail.
- Reviewers should verify no non-Stellar code was introduced into
  `src/chains/stellar/` by checking imports.
- To adjust the budget, update the `size-limit` array in `package.json`.

## Known Optimizations

1. **Lazy `@stellar/stellar-sdk` import** — `pubKeyToStellarAddress()` uses a
   dynamic `import()` instead of a top-level static import, ensuring the
   optional peer dependency is never loaded until the function is actually
   called. See `src/chains/stellar/scalar.ts`.

2. **No cross-chain leaks** — `src/chains/stellar/` imports zero code from
   `evm/`, `solana/`, `ckb/`, or `agent/` directories. All imports are
   local (`./`) or external npm packages (`@noble/curves`, `@noble/hashes`).
