# Bundle Size Report

> Generated: 2026-05-31T20:41:05.624Z
> Tooling: esbuild 0.21.5, minified + gzip

| Entry | Minified (KB) | Gzip (KB) |
|---|---|---|
| `index` | 2.26 | 0.98 |
| `chains/evm` | 69.87 | 25.07 |
| `chains/stellar` | 40.92 | 17.15 |
| `chains/solana` | 44.21 | 18.05 |
| `chains/ckb` | 56.44 | 21.60 |

## Cross-import audit

> Intentional cross-imports (expected):
> - `chains/solana` re-uses `chains/stellar` scalar math (ed25519)
> - `chains/ckb` re-uses `chains/evm` key derivation (secp256k1)
>
> Unexpected cross-imports found during this audit:
> - (none)

## Before / After

| Entry | Before (gzip KB) | After (gzip KB) | Delta |
|---|---|---|---|
| `chains/stellar` | TBD | 17.15 | TBD |
| `chains/evm` | TBD | 25.07 | TBD |
| `chains/solana` | TBD | 18.05 | TBD |
| `chains/ckb` | TBD | 21.60 | TBD |
| `index` | TBD | 0.98 | TBD |

> Before values are populated after the first CI run on main.
> After values reflect post-optimization sizes in this PR.
