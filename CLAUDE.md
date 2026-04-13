# Wraith Protocol SDK

You are building `@wraith-protocol/sdk` — the SDK for the Wraith multichain stealth address platform. This is the only npm package that developers install.

## What This Package Does

Three entry points, one `npm install`:

```
@wraith-protocol/sdk              → Agent client (Wraith, WraithAgent, Chain enum)
@wraith-protocol/sdk/chains/evm   → EVM stealth crypto primitives (secp256k1)
@wraith-protocol/sdk/chains/stellar → Stellar stealth crypto primitives (ed25519)
```

## Reference Code

- `reference/horizen/` — Working EVM SDK (`packages/sdk/src/`)
- `reference/stellar/` — Working Stellar SDK (`packages/sdk/src/`)
- `reference/docs/` — Full implementation specs

Read these BEFORE writing code. Do not copy files wholesale — understand the logic, then build into the new structure.

Key reference docs:

- `reference/docs/01-sdk-structure.md` — Package layout, exports, tsup config
- `reference/docs/02-evm-chain-crypto.md` — All EVM algorithms with exact math
- `reference/docs/03-stellar-chain-crypto.md` — All Stellar algorithms with exact math
- `reference/docs/06-agent-client-sdk.md` — Wraith/WraithAgent classes, Chain enum, types
- `reference/docs/08-testing.md` — Every test case with expected outputs

## Implementation Steps

Commit after each step. Each step must build and pass tests before moving on.

### Step 1 — Scaffold

```
package.json           # @wraith-protocol/sdk, exports for ".", "./chains/evm", "./chains/stellar"
tsconfig.json
tsup.config.ts         # multi-entry: index, chains/evm/index, chains/stellar/index
src/
  index.ts             # empty for now
  chains/evm/index.ts  # empty
  chains/stellar/index.ts  # empty
```

See `reference/docs/01-sdk-structure.md` for exact `package.json` exports and tsup config.

Verify: `pnpm install && pnpm build` produces `dist/` with all three entry points.

### Step 2 — EVM Chain Crypto

Port from `reference/horizen/packages/sdk/src/` into `src/chains/evm/`:

| File              | Purpose                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `constants.ts`    | `STEALTH_SIGNING_MESSAGE`, `SCHEME_ID = 1n`, `META_ADDRESS_PREFIX = "st:eth:0x"`             |
| `types.ts`        | `HexString`, `StealthKeys`, `GeneratedStealthAddress`, `Announcement`, `MatchedAnnouncement` |
| `keys.ts`         | `deriveStealthKeys(signature)` — split r/s, keccak256 each, validate scalars                 |
| `stealth.ts`      | `generateStealthAddress(spendPub, viewPub)` — ECDH, point addition, keccak256 address        |
| `scan.ts`         | `checkStealthAddress()`, `scanAnnouncements()` — view tag filter, address matching           |
| `spend.ts`        | `deriveStealthPrivateKey(spendKey, ephPub, viewKey)` — `(m + s_h) mod n`                     |
| `meta-address.ts` | `encodeStealthMetaAddress()`, `decodeStealthMetaAddress()` — `st:eth:0x` format              |
| `names.ts`        | `signNameRegistration()`, `signNameUpdate()`, `signNameRelease()`, `metaAddressToBytes()`    |
| `index.ts`        | Re-exports everything                                                                        |

Write tests in `test/chains/evm/`:

- `keys.test.ts` — valid derivation, determinism, spending != viewing, wrong length rejection
- `stealth.test.ts` — valid generation, determinism, different recipients → different addresses
- `scan.test.ts` — matches own, rejects wrong view tag, rejects wrong key, skips wrong scheme
- `spend.test.ts` — derived key controls stealth address, determinism
- `meta-address.test.ts` — encode/decode roundtrip, reject bad prefix/length
- `names.test.ts` — valid signatures, metaAddressToBytes
- `e2e.test.ts` — full flow: derive → generate → scan → spend → verify address match

See `reference/docs/02-evm-chain-crypto.md` for exact algorithms and `reference/docs/08-testing.md` for test cases.

Verify: `pnpm test` passes all EVM tests.

### Step 3 — Stellar Chain Crypto

Port from `reference/stellar/packages/sdk/src/` into `src/chains/stellar/`:

| File              | Purpose                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `constants.ts`    | `STEALTH_SIGNING_MESSAGE`, `SCHEME_ID = 1`, `META_ADDRESS_PREFIX = "st:xlm:"`                 |
| `types.ts`        | `StealthKeys` (Uint8Array + bigint scalars), `Announcement`, `MatchedAnnouncement`            |
| `keys.ts`         | `deriveStealthKeys(sig64)` — domain-separated SHA-256, seedToScalar                           |
| `stealth.ts`      | `generateStealthAddress()`, `computeSharedSecret()` (X25519 ECDH), `computeViewTag()`         |
| `scan.ts`         | `checkStealthAddress()`, `scanAnnouncements()` — view tag, point addition, scalar derivation  |
| `spend.ts`        | `deriveStealthPrivateScalar()`, `signStellarTransaction()`                                    |
| `scalar.ts`       | `seedToScalar()`, `hashToScalar()`, `deriveStealthPubKey()`, `signWithScalar()`, `L` constant |
| `meta-address.ts` | encode/decode `st:xlm:` format (32-byte ed25519 keys)                                         |
| `utils.ts`        | `bytesToHex()`, `hexToBytes()`                                                                |
| `index.ts`        | Re-exports everything                                                                         |

Write tests in `test/chains/stellar/` — same categories as EVM adapted for ed25519.

See `reference/docs/03-stellar-chain-crypto.md` for exact algorithms.

Verify: `pnpm test` passes all Stellar tests.

### Step 4 — Agent Client

Implement in `src/agent/`:

| File        | Purpose                                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`  | `Chain` enum (Horizen, Ethereum, Polygon, Base, Stellar, Solana, All), `WraithConfig`, `AgentConfig`, `AgentInfo`, `ChatResponse`, etc. |
| `client.ts` | `Wraith` class (API client), `WraithAgent` class (per-agent methods)                                                                    |
| `index.ts`  | Re-exports                                                                                                                              |

Then update `src/index.ts` to export from `./agent/`.

Key details:

- `Chain` is an enum, not a string
- `AgentConfig.chain` accepts `Chain | Chain[]` for single or multichain
- `Chain.All` creates agent on every supported chain
- `AgentInfo` has `chains: Chain[]`, `addresses: Record<Chain, string>`, `metaAddresses: Record<Chain, string>`
- HTTP client uses native `fetch` — zero heavy deps
- Auth via `Authorization: Bearer wraith_...` header
- Optional `X-AI-Provider` + `X-AI-Key` headers for BYOM

See `reference/docs/06-agent-client-sdk.md` for full class implementations.

Write tests in `test/agent/client.test.ts` with a mock HTTP server.

Verify: `pnpm build` produces all three entry points, `pnpm test` passes everything.

## Final Structure

```
sdk/
  package.json
  tsconfig.json
  tsup.config.ts
  src/
    index.ts                      # re-exports from agent/
    agent/
      index.ts
      client.ts                   # Wraith, WraithAgent
      types.ts                    # Chain enum, all types
    chains/
      evm/
        index.ts
        constants.ts
        types.ts
        keys.ts
        stealth.ts
        scan.ts
        spend.ts
        meta-address.ts
        names.ts
      stellar/
        index.ts
        constants.ts
        types.ts
        keys.ts
        stealth.ts
        scan.ts
        spend.ts
        meta-address.ts
        scalar.ts
        utils.ts
  test/
    chains/
      evm/
        keys.test.ts
        stealth.test.ts
        scan.test.ts
        spend.test.ts
        meta-address.test.ts
        names.test.ts
        e2e.test.ts
      stellar/
        keys.test.ts
        stealth.test.ts
        scan.test.ts
        spend.test.ts
        meta-address.test.ts
        e2e.test.ts
    agent/
      client.test.ts
  reference/                      # DO NOT MODIFY
    horizen/                      # existing Horizen SDK
    stellar/                      # existing Stellar SDK
    docs/                         # implementation specs
```

## README

Create a README.md covering: what @wraith-protocol/sdk is, installation, the three entry points (root agent client, chains/evm, chains/stellar), quick code examples for each entry point, the Chain enum with All option, available types, and links to wraith-protocol/docs. Keep it concise and technical.

## Code Quality Tooling

### Prettier

Add `.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

Add `.prettierignore`:

```
dist
node_modules
reference
```

Add scripts to `package.json`:

```json
{
  "format": "prettier --write .",
  "format:check": "prettier --check ."
}
```

### Husky + Commitlint

Set up husky with a pre-commit hook that runs `prettier --check` and a commit-msg hook that enforces conventional commits.

Install: `husky`, `@commitlint/cli`, `@commitlint/config-conventional`, `prettier`

Add `commitlint.config.js`:

```js
module.exports = { extends: ['@commitlint/config-conventional'] };
```

Husky hooks:

- `.husky/pre-commit`: `pnpm format:check && pnpm build && pnpm test`
- `.husky/commit-msg`: `npx --no -- commitlint --edit $1`

Commit messages must follow conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`

### CI

Add `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run format:check
      - run: pnpm build
      - run: pnpm test
```

## Rules

- NEVER add Co-Authored-By lines to commits
- NEVER commit, modify, or delete anything in the reference/ folder — it is gitignored and read-only
- NEVER add numbered step comments in code
- NEVER strip existing NatSpec/docs from reference code when porting
- All commit messages MUST follow conventional commits format (feat:, fix:, chore:, docs:, test:, refactor:)
- Commit after each completed step
- Push to origin after each completed step
- Write tests alongside implementation, not after
- Steps 2 and 3 can be done in parallel (separate agents)
- Use Vitest for all tests
- Dependencies: `@noble/curves`, `@noble/hashes`, `viem` (direct), `@stellar/stellar-sdk` (optional peer)
