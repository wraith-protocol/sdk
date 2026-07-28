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
- `describe.skipIf()`, `it.skipIf()` — Conditional test skipping (Bun: 1.2+)
- `beforeEach()`, `afterEach()` — Lifecycle hooks
- `expect()` — All assertions
- Standard Node globals: `fetch`, `process`, `Buffer`, `TextEncoder`, etc.

### ⚠️ Vitest Only (with Bun Compat Stubs)

These are Vitest-specific. We provide limited Bun compatibility through `test/setup.ts`:

| API                     | Vitest  | Bun              | Notes                                                            |
| ----------------------- | ------- | ---------------- | ---------------------------------------------------------------- |
| `vi.fn()`               | ✅ Full | 🟡 Stub          | Tracks calls & args. Missing `.mock.results`, advanced matchers. |
| `vi.mock()`             | ✅ Full | ❌ Not supported | Use manual imports or skip test in Bun. ↓                        |
| `vi.stubGlobal()`       | ✅ Full | 🟡 Stub          | Saves/restores globals. No spy capability.                       |
| `vi.clearAllMocks()`    | ✅ Full | 🟡 Stub          | Clears tracked calls.                                            |
| `vi.restoreAllMocks()`  | ✅ Full | 🟡 Stub          | Alias for `clearAllMocks()` in Bun.                              |
| `vi.resetAllMocks()`    | ✅ Full | 🟡 Stub          | Same as `clearAllMocks()` in Bun.                                |
| `vi.unstubAllGlobals()` | ✅ Full | 🟡 Stub          | Restores all stubbed globals.                                    |
| `vi.useRealTimers()`    | ✅ Full | ⏭️ No-op         | Bun always uses native timers.                                   |

### ❌ Not Supported in Bun

These features have **no equivalent** in Bun and tests using them are skipped in Bun:

- `vi.mock()` / `vi.unmock()` — Module mocking
- `vi.spyOn()` — Spying on methods
- `vi.fake.timers()` — Fake timers
- `vi.hoisted()` — Pre-import code execution
- Snapshot testing (`.snap` files)
- `.mockReturnThis()` — Chainable mock methods

**Tests skipped in Bun:**

- `test/chains/stellar/announcements.test.ts` — Uses `vi.mock()` and `vi.stubGlobal()`
- `test/chains/stellar/asset.test.ts` — Uses `vi.mock()` and `.mockReturnThis()`

**How to conditionally skip tests:**

```typescript
const isBun = typeof Bun !== 'undefined';

describe.skipIf(isBun)('Vitest-only feature', () => {
  it('vitest-only test', () => {
    // This test only runs in Vitest
  });
});

describe('Compatible tests', () => {
  it('works in both runners', () => {
    // Use only supported APIs
  });
});
```

## Import Compat Layer

Use the compat layer from `test/setup.ts` for consistent behavior across runners:

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
  unstubAllGlobals, // Instead of vi.unstubAllGlobals()
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

## CI Matrix

`.github/workflows/ci.yml` runs both test runners in parallel:

```yaml
test:
  strategy:
    matrix:
      node-version: [20, 22]

test-bun:
  # Runs with latest Bun
  # Excludes property fuzz tests and memory leak tests (too slow for Bun)
```

**Both must pass for a green build.**

## Notes

- Bun's runner is **~2-3x faster** than Vitest for simple I/O-bound tests
- Vitest remains primary; Bun is a second validator
- Some tests are Vitest-only; they're documented with `.skipIf(typeof Bun !== 'undefined')()`
- Large fuzz and leak detection tests are excluded from Bun runs (see CI workflow)
