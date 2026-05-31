# Contributing to `@wraith-protocol/sdk`

Thanks for your interest in contributing! This document is the source of truth for **how we
version, deprecate, release, review, and extend** `@wraith-protocol/sdk`.

It exists because the SDK is the single npm package every Wraith developer installs — a sloppy
breaking change ripples across every downstream wallet, agent, and integration. Read this before
opening a PR.

> **TL;DR**
>
> - We follow [Semantic Versioning](https://semver.org/) **strictly**.
> - **Cryptographic behavior changes are always major** — even if the TypeScript types don't change.
> - Deprecations get one major version of grace and a runtime warning.
> - Commits follow [Conventional Commits](https://www.conventionalcommits.org/). PRs are squashed.
> - Adding a chain? See [§5 How to add a new chain](#5-how-to-add-a-new-chain).

---

## Table of contents

1. [Semver policy](#1-semver-policy)
2. [Deprecation policy](#2-deprecation-policy)
3. [Release process](#3-release-process)
4. [PR conventions](#4-pr-conventions)
5. [How to add a new chain](#5-how-to-add-a-new-chain)

---

## 1. Semver policy

We version the SDK as `MAJOR.MINOR.PATCH` per [semver.org](https://semver.org/):

- **MAJOR** — incompatible API or behavior change. Downstream code may break.
- **MINOR** — backward-compatible functionality added.
- **PATCH** — backward-compatible bug fix or internal cleanup.

The table below is the authoritative classifier. When in doubt, **prefer the higher bump** —
shipping a quiet major as a minor is the most expensive mistake we can make.

| Change                                                           | Bump      |
| ---------------------------------------------------------------- | --------- |
| New chain module added (e.g., `chains/hedera`)                   | **MINOR** |
| New function exported from a chain module                        | **MINOR** |
| Function signature changed (param added / type changed / return) | **MAJOR** |
| Function removed                                                 | **MAJOR** |
| Cryptographic behavior changed (domain prefix, view-tag scheme)  | **MAJOR** |
| Type tightened (e.g., `string` → `` `0x${string}` ``)            | **MAJOR** |
| Type loosened (e.g., `` `0x${string}` `` → `string`)             | **MINOR** |
| Bundler / `package.json` `exports` field changes                 | **MAJOR** |
| Dependency major bumped (e.g., `@noble/curves` 1 → 2)            | **MAJOR** |
| Default network / RPC URL changed                                | **MAJOR** |
| Bug fix that changes a previously-buggy observable behavior      | **MAJOR** |
| Pure internal refactor, no observable change                     | **PATCH** |
| Doc-only / typo fix in JSDoc visible to consumers                | **PATCH** |

The subsections below show **each rule applied to real code** so reviewers and contributors agree
on the call.

### 1.1 New chain module added → **MINOR**

A new entry point under `chains/<name>` is additive. Existing imports do not break.

**Example A — adding Hedera:**

```diff
 // package.json
   "exports": {
     ".": { ... },
     "./chains/evm": { ... },
+    "./chains/hedera": {
+      "types": "./dist/chains/hedera/index.d.ts",
+      "import": "./dist/chains/hedera/index.js",
+      "require": "./dist/chains/hedera/index.cjs"
+    }
   }
```

`1.4.5` → `1.5.0`. Even though we touched `package.json`'s `exports` field, we only **added**
keys, so it is not a breaking export-map change (see §1.8).

**Example B — adding Aptos:**

Same shape: new folder under `src/chains/aptos/`, new entry in `exports`, new tests under
`test/chains/aptos/`. `1.5.0` → `1.6.0`.

### 1.2 New function exported from a chain module → **MINOR**

Adding a new named export is additive. Existing callers ignore it.

**Example A — exporting a new helper:**

```diff
 // src/chains/evm/index.ts
 export { generateStealthAddress } from './stealth';
+export { batchGenerateStealthAddresses } from './stealth';
```

`1.4.5` → `1.5.0`.

**Example B — exporting a new builder:**

```diff
 // src/chains/solana/index.ts
 export { buildSendSol, buildAnnounce } from './builders';
+export { buildBatchAnnounce } from './builders';
```

`1.5.0` → `1.6.0`.

### 1.3 Function signature changed → **MAJOR**

Any change to parameters, parameter types, or return shape that an existing caller can observe.

**Example A — adding a required parameter:**

```diff
-export function generateStealthAddress(spendingPubKey: Hex, viewingPubKey: Hex): Generated;
+export function generateStealthAddress(
+  spendingPubKey: Hex,
+  viewingPubKey: Hex,
+  scheme: SchemeId,
+): Generated;
```

`1.4.5` → `2.0.0`. (If the new parameter were **optional** with a backward-compatible default,
this would still be **MAJOR** if it changes the return value for existing call sites; otherwise
**MINOR**. When unsure, ship it as major.)

**Example B — changing a return field:**

```diff
 export interface GeneratedStealthAddress {
   stealthAddress: HexString;
   ephemeralPubKey: HexString;
-  viewTag: number;
+  viewTag: HexString;
 }
```

`1.4.5` → `2.0.0`.

### 1.4 Function removed → **MAJOR**

Any export disappearing from the public surface — including a re-export removed from a chain
module's `index.ts`.

**Example A — removing a deprecated helper:**

```diff
 // src/chains/evm/index.ts
-export { legacyDeriveStealthKeys } from './keys';
```

`1.4.5` → `2.0.0`, even if the helper was marked `@deprecated` in `1.x`. See §2 for how to
deprecate cleanly first.

**Example B — collapsing two functions into one:**

```diff
-export { scanAnnouncements, scanAnnouncementsBatch } from './scan';
+export { scanAnnouncements } from './scan';  // now accepts a batch flag
```

`1.5.0` → `2.0.0`. The removal is breaking even though the surviving function gained capability.

### 1.5 Cryptographic behavior changed → **MAJOR**

**Crypto changes are always major.** Anyone who scanned with the old scheme will silently miss
funds if we ship the new one as a minor. This is non-negotiable, even if the TypeScript types are
byte-identical.

**Example A — new domain-separation prefix:**

```diff
 // src/chains/evm/constants.ts
-export const STEALTH_SIGNING_MESSAGE = 'Wraith stealth keys v1';
+export const STEALTH_SIGNING_MESSAGE = 'Wraith stealth keys v2';
```

`1.4.5` → `2.0.0`. Every meta-address derived from a wallet signature changes.

**Example B — view-tag scheme change:**

```diff
 // src/chains/stellar/stealth.ts
-export function computeViewTag(sharedSecret: Uint8Array): number {
-  return sharedSecret[0];
-}
+export function computeViewTag(sharedSecret: Uint8Array): number {
+  return sha256(sharedSecret)[0];
+}
```

`1.4.5` → `2.0.0`. Recipients with old scanners stop matching announcements from new senders and
vice versa.

### 1.6 Type tightened → **MAJOR**

Narrowing a type rejects code that previously compiled. That breaks consumers.

**Example A — narrowing `string` to a branded hex type:**

```diff
-export function deriveStealthKeys(signature: string): StealthKeys;
+export function deriveStealthKeys(signature: `0x${string}`): StealthKeys;
```

`1.4.5` → `2.0.0`. Callers passing `signature: string` from a generic source now get a TS error.

**Example B — narrowing a union:**

```diff
-export type Chain = 'horizen' | 'ethereum' | 'polygon' | 'base' | string;
+export type Chain = 'horizen' | 'ethereum' | 'polygon' | 'base';
```

`1.5.0` → `2.0.0`. Anyone passing a custom chain string now fails to compile.

### 1.7 Type loosened → **MINOR**

Widening a type is backward-compatible — every previously-valid value remains valid.

**Example A — widening a return type to include a new field:**

```diff
 export interface AgentInfo {
   name: string;
   chains: Chain[];
+  metadata?: Record<string, unknown>;
 }
```

`1.5.0` → `1.6.0`. The field is optional, so old code reading `AgentInfo` still type-checks.

**Example B — widening a parameter union:**

```diff
-export function fetchAnnouncements(chain: 'horizen' | 'ethereum'): Promise<Announcement[]>;
+export function fetchAnnouncements(chain: Chain): Promise<Announcement[]>;
```

`1.5.0` → `1.6.0`.

### 1.8 Bundler config / `package.json` `exports` changes → **MAJOR**

Reshaping the export map can break bundlers, TypeScript resolution, and CommonJS consumers — even
if our source code is unchanged. Default to **MAJOR** for any change to `exports`, `main`,
`module`, `types`, or `type`.

**Example A — renaming an entry point:**

```diff
-    "./chains/evm": { ... },
+    "./evm": { ... },
```

`1.4.5` → `2.0.0`. Every `import … from '@wraith-protocol/sdk/chains/evm'` breaks.

**Example B — dropping the CJS condition:**

```diff
   "./chains/evm": {
     "types": "./dist/chains/evm/index.d.ts",
-    "import": "./dist/chains/evm/index.js",
-    "require": "./dist/chains/evm/index.cjs"
+    "import": "./dist/chains/evm/index.js"
   }
```

`1.5.0` → `2.0.0`. CJS consumers (Node `require`, some bundler configs) stop resolving.

> **Exception.** **Adding** a new entry point is **MINOR** (see §1.1). The "major" rule applies
> to renaming, removing, or restructuring existing ones.

### 1.9 Dependency major bumped → **MAJOR**

Our crypto comes from `@noble/curves` and `@noble/hashes`. A major bump in either may change
return shapes, scalar handling, or input encodings. Even if our own re-exports are unchanged, the
**runtime crypto bytes can shift**, which is breaking by definition.

**Example A — `@noble/curves` 1.x → 2.x:**

```diff
 // package.json
-    "@noble/curves": "^1.8.0",
+    "@noble/curves": "^2.0.0",
```

`1.4.5` → `2.0.0`. Run the full conformance test matrix from issue #08 before merging.

**Example B — `viem` 2.x → 3.x:**

```diff
-    "viem": "^2.23.0",
+    "viem": "^3.0.0",
```

`1.5.0` → `2.0.0`. Even if our code compiles unchanged, downstream apps pinning `viem@^2` get a
peer/version conflict.

> **Minor/patch dep bumps** (e.g., `@noble/curves` `^1.8.0` → `^1.9.0`) are **PATCH** on our end,
> unless the upgrade fixes an observable bug that previously-correct code relied on (then see
> §1.11).

### 1.10 Default network / RPC URL changed → **MAJOR**

The defaults in `deployments.ts` are part of the public contract. Changing them silently routes
production traffic to a new endpoint or contract — that's breaking.

**Example A — switching the default Solana RPC:**

```diff
 // src/chains/solana/deployments.ts
 export const DEPLOYMENTS = {
   'solana-mainnet': {
-    rpcUrl: 'https://api.mainnet-beta.solana.com',
+    rpcUrl: 'https://solana-rpc.wraith.network',
     ...
   },
 };
```

`1.4.5` → `2.0.0`. Apps that relied on the public Solana endpoint now hit ours.

**Example B — changing a deployed contract address:**

```diff
 // src/chains/evm/deployments.ts
   'horizen-mainnet': {
-    announcer: '0xAAA...AAA',
+    announcer: '0xBBB...BBB',
   },
```

`1.5.0` → `2.0.0`. Scanners pointed at the old address miss every new announcement.

### 1.11 Bug fix that changes a previously-buggy behavior → **MAJOR**

If anyone could have relied on the bug — e.g., the previous code produced a deterministic but
wrong byte sequence — the fix is breaking. This is Hyrum's Law: every observable behavior is
someone's API.

**Example A — fixing a scalar reduction:**

```diff
-  return hash;                    // bug: not reduced mod L
+  return mod(hash, L);            // fix: reduce mod curve order
```

`1.4.5` → `2.0.0`. Every key derived under the buggy code differs from a key derived under the
fixed code.

**Example B — fixing a view-tag off-by-one:**

```diff
-  return sharedSecret[1];         // bug: should be byte 0
+  return sharedSecret[0];
```

`1.5.0` → `2.0.0`. Old senders and new recipients mismatch every announcement.

> **When the buggy behavior was unobservable** (e.g., a typo in an internal variable name, a
> wasted allocation) the fix is **PATCH**. The test is: could a caller distinguish the two
> behaviors? If yes, major. If no, patch.

---

## 2. Deprecation policy

We deprecate before removing. Contributors and downstream apps deserve a runway — and a chance
to migrate before the next major.

### 2.1 Lifecycle

- A deprecated export must remain functional for **at least one full major version** after the
  deprecation lands. If we deprecate `oldFn` in `1.6.0`, the earliest we may remove it is in the
  `2.0.0` release.
- The deprecation must ship with a `@deprecated` JSDoc tag **and** a runtime warning on first use
  (not on import — we cannot fire side effects on module load).

### 2.2 How to mark it

**Example A — deprecating a function in favor of a successor:**

```ts
// src/chains/evm/keys.ts

let warned = false;

/**
 * @deprecated Since 1.6.0. Use {@link deriveStealthKeysV2} instead.
 * Will be removed in 2.0.0. See MIGRATING.md for details.
 */
export function deriveStealthKeys(signature: HexString): StealthKeys {
  if (!warned) {
    console.warn(
      '[@wraith-protocol/sdk] deriveStealthKeys is deprecated and will be removed in 2.0.0. ' +
        'Use deriveStealthKeysV2 instead. See MIGRATING.md.',
    );
    warned = true;
  }
  return deriveStealthKeysV2(signature);
}
```

The `warned` flag keeps the console clean — one warning per process, not one per call.

**Example B — deprecating an exported type alias:**

```ts
/** @deprecated Since 1.7.0. Use `Announcement` instead. Will be removed in 2.0.0. */
export type StealthAnnouncement = Announcement;
```

Type aliases cannot warn at runtime — the JSDoc tag and the [MIGRATING.md](./MIGRATING.md) entry
are the contract.

### 2.3 Where it's documented

Every deprecation gets three entries:

1. A **CHANGELOG.md** entry under the release that introduced it, prefixed `Deprecated:`.
2. A row in [MIGRATING.md](./MIGRATING.md) under the upcoming major's section.
3. The `@deprecated` JSDoc — IDEs surface this to consumers directly.

---

## 3. Release process

### 3.1 Who can publish

- npm publish rights are held by the `@wraith-protocol` org admins. Currently:
  [@wraith-protocol/maintainers](https://github.com/orgs/wraith-protocol/teams).
- Releases run from GitHub Actions ([.github/workflows/publish.yml](./.github/workflows/publish.yml)) —
  contributors never publish from a laptop. The workflow fires on `package.json` version bumps to
  `main` and uses the `NPM_TOKEN` org secret.
- Manual publish (`pnpm publish`) is reserved for emergencies and requires two maintainer
  approvals.

### 3.2 Pre-publish checklist

A release PR must check every box before it can land on `main`:

- [ ] All CI jobs green ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) — `pnpm format:check`, `pnpm build`, `pnpm test`.
- [ ] Conformance tests pass for every chain module (`test/chains/*/e2e.test.ts`).
- [ ] Microbenchmarks recorded (`pnpm bench`) — if a hot path regressed >10%, comment with the
      diff and justify or revert.
- [ ] `package.json` `version` bumped following §1.
- [ ] `CHANGELOG.md` updated — one entry per change, grouped under `Added` / `Changed` /
      `Deprecated` / `Removed` / `Fixed` / `Security`.
- [ ] For majors: `MIGRATING.md` updated with concrete before/after snippets.
- [ ] Git tag matches the version: `git tag v1.6.0 && git push --tags`.

**Example A — minor release PR title:**

```
release: 1.5.0 — add chains/hedera + buildBatchAnnounce
```

**Example B — major release PR title:**

```
release: 2.0.0 — viem 3, narrowed Chain enum, drop legacyDeriveStealthKeys
```

### 3.3 Cadence

- **Patch** — biweekly, on the second and fourth Tuesday. Skipped if no fixes are queued.
- **Minor** — monthly, on the first Tuesday. Skipped if nothing new shipped.
- **Major** — quarterly. Branch off `next` six weeks before the release date, RC tag two weeks
  before, GA on schedule.

These are **targets, not deadlines**. We do not ship to the calendar — we ship when CI is green
and the changelog is honest.

---

## 4. PR conventions

### 4.1 Conventional Commits — required

Commit messages and PR titles MUST follow [Conventional Commits](https://www.conventionalcommits.org/).
This is enforced by `commitlint` via the [pre-commit Husky hook](./.husky/commit-msg).

**Allowed types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`, `revert`.

**Example A — a feature commit:**

```
feat(chains/solana): add buildBatchAnnounce helper

Builds a single transaction that announces N stealth payments
in one instruction. Reduces fees vs. one-tx-per-announcement.
```

**Example B — a breaking-change commit:**

```
feat(chains/evm)!: change view-tag derivation to sha256 byte 0

BREAKING CHANGE: scanners running 1.x will not match announcements
from 2.x senders. See MIGRATING.md §"View tag v2".
```

The trailing `!` and the `BREAKING CHANGE:` footer both signal a major.

### 4.2 Squash vs. merge

- We **squash and merge** every PR. The PR title becomes the squash commit's subject, so it must
  also be a valid Conventional Commit.
- We do **not** rebase-merge or merge-commit. This keeps `main`'s history linear and lets
  `git log --oneline` double as a changelog draft.

### 4.3 Required reviewers

- All PRs require **one maintainer approval** from
  [@wraith-protocol/maintainers](https://github.com/orgs/wraith-protocol/teams).
- PRs that touch `src/chains/*/stealth.ts`, `*/scan.ts`, `*/keys.ts`, `*/spend.ts`, or any file
  with cryptographic constants require **two** maintainer approvals — at least one with crypto
  review history.
- Doc-only PRs (this file, `README.md`, `MIGRATING.md`, JSDoc) require **one** approval.

**Example A — a one-approval PR:**

> `docs(readme): clarify Solana view-tag example` — touches only `README.md`. One reviewer.

**Example B — a two-approval PR:**

> `feat(chains/ckb)!: switch announcement scanning to packed lock-args` — touches
> `src/chains/ckb/scan.ts` and `src/chains/ckb/stealth.ts`. Two reviewers, one crypto-experienced.

---

## 5. How to add a new chain

Use this rubric when adding `src/chains/<name>/`. It is intentionally short — the conformance
contract in [issue #08](https://github.com/wraith-protocol/sdk/issues/8) is the long-form spec.

### 5.1 Rubric

1. **Implement the conformance contract.** Every chain module must export these symbols with
   matching signatures:

   ```ts
   export function deriveStealthKeys(signature): StealthKeys;
   export function generateStealthAddress(spendingPubKey, viewingPubKey): GeneratedStealthAddress;
   export function scanAnnouncements(
     announcements,
     viewingKey,
     spendingPubKey,
     spendingKey,
   ): MatchedAnnouncement[];
   export function deriveStealthPrivateKey(spendingKey, ephemeralPubKey, viewingKey): PrivKey;
   export function encodeStealthMetaAddress(spendingPubKey, viewingPubKey): string;
   export function decodeStealthMetaAddress(metaAddress: string): { spendingPubKey; viewingPubKey };
   export const STEALTH_SIGNING_MESSAGE: string;
   export const SCHEME_ID: bigint;
   export const META_ADDRESS_PREFIX: string;
   ```

   Chain-native shapes (e.g., CKB returns `lockArgs` instead of an EOA address) are fine — the
   _names_ and _roles_ are what conform.

2. **Write tests.** Every new chain must mirror the structure under `test/chains/evm/`:

   ```
   test/chains/<name>/
     keys.test.ts
     meta-address.test.ts
     stealth.test.ts
     scan.test.ts
     spend.test.ts
     e2e.test.ts
   ```

   The `e2e.test.ts` runs the conformance vectors from issue #08 against the new module.

3. **Add to the build matrix.** Append the new entry point to `package.json` `exports` and to
   the multi-entry config in [`tsup.config.ts`](./tsup.config.ts). Confirm with:

   ```bash
   pnpm clean && pnpm build
   ls dist/chains/<name>/index.{js,cjs,d.ts}
   ```

4. **Document.** Add a section to [`README.md`](./README.md) matching the shape of the existing
   EVM/Stellar/Solana/CKB sections, and a doc page under `reference/docs/` if the cryptography
   is novel.

5. **Bump MINOR.** Adding a chain module is additive — bump per §1.1.

### 5.2 Worked example — adding `chains/hedera`

```bash
# 1. Scaffold
mkdir -p src/chains/hedera test/chains/hedera
cp src/chains/evm/{constants,types,keys,stealth,scan,spend,meta-address,index}.ts \
   src/chains/hedera/
# (now adapt each file to Hedera's signature scheme + address format)

# 2. Register the entry point
#    edit package.json -> exports['./chains/hedera']
#    edit tsup.config.ts -> entry: [..., 'src/chains/hedera/index.ts']

# 3. Verify
pnpm clean && pnpm build && pnpm test
pnpm test test/chains/hedera/e2e.test.ts

# 4. Bump
#    edit package.json -> "version": "1.5.0"
#    edit CHANGELOG.md -> Added: chains/hedera
```

### 5.3 Worked example — adding `chains/aptos`

Same five steps. Because Aptos uses ed25519 (like Stellar and Solana), start by copying
`src/chains/solana/` rather than the EVM scaffold, then swap address encoding for AIP-9
(BCS-serialized account address). Cite the spec source in a header comment so future
reviewers can verify our derivation matches Aptos's canonical one.

---

## Questions?

Open a discussion in [wraith-protocol/sdk/discussions](https://github.com/wraith-protocol/sdk/discussions),
or ping a maintainer in the issue you're working from. Thanks for contributing.
