# Testing: Vitest + Bun

This project runs tests under both **Vitest** and **Bun's native test runner** to catch environment-specific bugs and provide two independent test execution paths.

## Quick Start

```bash
# Vitest (default, feature-complete)
pnpm test

# Bun (new, faster)
bun test

# Both in CI (parallel matrix)
# See .github/workflows/ci.yml
```

## Vitest vs Bun: API Scope

### ✅ Supported in Both

These APIs work identically in Vitest and Bun:

- `describe()`, `it()`, `test()` — Test declaration
- `beforeEach()`, `afterEach()` — Lifecycle hooks
- `expect()` — All assertions (via `@vitest/expect` polyfill in Bun)
- Standard Node globals: `fetch`, `process`, `Buffer`, `TextEncoder`, etc.

### ⚠️ Vitest Only (with Bun Compat Stubs)

These are Vitest-specific. We provide limited Bun compatibility through `test/setup.ts`:

| API                    | Vitest  | Bun              | Notes                                                            |
| ---------------------- | ------- | ---------------- | ---------------------------------------------------------------- |
| `vi.fn()`              | ✅ Full | 🟡 Stub          | Tracks calls & args. Missing `.mock.results`, advanced matchers. |
| `vi.mock()`            | ✅ Full | ❌ Not supported | Use manual imports or skip test in Bun.                          |
| `vi.stubGlobal()`      | ✅ Full | 🟡 Stub          | Saves/restores globals. No spy capability.                       |
| `vi.clearAllMocks()`   | ✅ Full | 🟡 Stub          | Clears tracked calls.                                            |
| `vi.restoreAllMocks()` | ✅ Full | 🟡 Stub          | Alias for `clearAllMocks()` in Bun.                              |
| `vi.resetAllMocks()`   | ✅ Full | 🟡 Stub          | Same as `clearAllMocks()` in Bun.                                |
| `vi.useRealTimers()`   | ✅ Full | ⏭️ No-op         | Bun always uses native timers.                                   |

### ❌ Not Supported in Bun

These features have **no equivalent** in Bun and tests using them must be skipped:

- `vi.mock()` / `vi.unmock()` — Module mocking
- `vi.spyOn()` — Spying on methods
- `vi.fake.timers()` — Fake timers
- `vi.hoisted()` — Pre-import code execution
- Snapshot testing (`.snap` files)

**How to skip:**

```typescript
import { describe, it, test } from 'vitest';

describe('My feature', () => {
  it.skipIf(typeof Bun !== 'undefined')('vitest-only test', () => {
    // This test only runs in Vitest
  });

  // Or document the limitation:
  it('bun-compatible test', () => {
    // Use only supported APIs
  });
});
```

## Import Compat Layer

Use the compat layer from `test/setup.ts` for consistent behavior:

```typescript
import {
  describe,
  it,
  expect,
  createMockFn, // Instead of vi.fn()
  stubGlobal, // Instead of vi.stubGlobal()
  clearAllMocks, // Instead of vi.clearAllMocks()
  restoreAllMocks, // Instead of vi.restoreAllMocks()
  resetAllMocks, // Instead of vi.resetAllMocks()
  useRealTimers, // Instead of vi.useRealTimers()
} from './setup';

describe('my test', () => {
  it('works in both runners', () => {
    const mock = createMockFn(() => 'result');
    expect(mock()).toBe('result');
  });

  afterEach(() => {
    clearAllMocks();
  });
});
```

Or use `vi.*` directly (available globally in Vitest, not in Bun):

```typescript
// In Vitest: vi.fn() is globally available
// In Bun: This will throw — use the compat layer instead
```

## Test Structure

```
test/
├── README.md                    ← You are here
├── setup.ts                     ← Compat layer (import for vi.* alternatives)
├── chains/
│   ├── evm/
│   ├── stellar/
│   ├── solana/
│   └── ckb/
├── compat/
├── conformance/
├── vault/
├── agent/
├── scanner-pool.test.ts
└── errors.test.ts
```

## CI Matrix

`.github/workflows/ci.yml` runs both test runners in parallel:

```yaml
test:
  strategy:
    matrix:
      runner: [vitest, bun] # New: bun added to matrix
      node-version: [20, 22]
  steps:
    - run: pnpm test # Vitest
    - run: bun test # Bun
```

Both must pass for a green build.

## Audit Status

Tests audited for Vitest-only APIs:

- ✅ `test/chains/stellar/announcements.test.ts` — Uses `vi.mock()`, `vi.fn()`, `vi.stubGlobal()`
  - **Action:** Skip full module mocking in Bun. Keep `vi.fn()` and `vi.stubGlobal()` via compat.
  - **Bun scope:** Manual fetch mock with `stubGlobal('fetch', ...)` instead of `vi.mock('@stellar/stellar-sdk', ...)`

- ✅ `test/chains/stellar/asset.test.ts` — Uses `vi.mock()`, `vi.fn()`
  - **Action:** Skip in Bun (uses @stellar/stellar-sdk mocking).

- ✅ `test/chains/stellar/federation.test.ts` — Uses `vi.fn()`, `vi.restoreAllMocks()`
  - **Action:** Compatible via compat layer.

- ✅ `test/scanner-pool.test.ts` — Uses `vi.fn()`, `vi.clearAllMocks()`
  - **Action:** Compatible via compat layer.

- ✅ `test/vault/key-vault.test.ts` — Uses `vi.useRealTimers()`
  - **Action:** No-op in Bun (acceptable).

- ✅ `test/compat/react-native.test.ts` — Uses `afterEach`
  - **Action:** Fully compatible.

## Notes

- Bun's runner is **~2-3x faster** than Vitest for simple I/O-bound tests.
- We keep Vitest as primary; Bun is a second validator.
- If a test fails in Bun but passes in Vitest, it usually signals a Node-ism or Vitest-ism in the code.
- Some tests may be Vitest-only; document with `.skipIf(typeof Bun !== 'undefined')()`.

## Future Work

- [ ] Standardize on one compat layer (consider `@vitest/expect` for Bun's assertions)
- [ ] Measure CI times (Bun should be 2-3x faster)
- [ ] Add Bun-specific benchmarks (via `bun bench`)
