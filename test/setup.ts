/**
 * Test setup and compatibility layer for Vitest and Bun test runners.
 *
 * Vitest: Standard globals (describe, it, expect, vi.*) are auto-injected
 * Bun: Uses native test API; this shim provides Vitest-compatible mocking
 */

// Re-export test globals (both runners have these)
// For Bun compatibility: check if these exist before exporting
let describe: any;
let it: any;
let test: any;
let expect: any;
let beforeEach: any;
let afterEach: any;

if (typeof globalThis !== 'undefined' && (globalThis as any).describe) {
  // Vitest or Bun native test globals already exist
  ({ describe, it, test, expect, beforeEach, afterEach } = globalThis as any);
} else {
  // Fallback (shouldn't happen, but for safety)
  ({ describe, it, test, expect, beforeEach, afterEach } = require('vitest'));
}

export { describe, it, test, expect, beforeEach, afterEach };

// Mock tracking for Bun
const mockStack: Array<{ calls: any[][] }> = [];
const globalStubs = new Map<string, any>();

/**
 * Create a mock function compatible with both Vitest and Bun.
 * In Vitest, delegates to vi.fn(). In Bun, provides basic tracking.
 */
export function createMockFn<T extends (...args: any[]) => any>(implementation?: T): any {
  // Check if vi is available (Vitest)
  if (typeof (globalThis as any).vi !== 'undefined' && (globalThis as any).vi.fn) {
    return (globalThis as any).vi.fn(implementation);
  }

  // Bun fallback: basic mock
  const calls: any[][] = [];
  const mock = function (...args: any[]) {
    calls.push(args);
    return implementation?.(...args);
  };

  (mock as any).mock = { calls };
  mockStack.push({ calls });
  return mock;
}

/**
 * Stub a global variable. In Vitest, uses vi.stubGlobal(). In Bun, sets directly.
 */
export function stubGlobal<K extends keyof typeof globalThis>(key: K, value: unknown): void {
  if (typeof (globalThis as any).vi !== 'undefined' && (globalThis as any).vi.stubGlobal) {
    return (globalThis as any).vi.stubGlobal(key, value);
  }

  // Bun: save original and set
  if (!globalStubs.has(key as string)) {
    globalStubs.set(key as string, (globalThis as any)[key]);
  }
  (globalThis as any)[key] = value;
}

/**
 * Clear all mocks and stubs. In Vitest, uses vi.clearAllMocks(). In Bun, resets stubs.
 */
export function clearAllMocks(): void {
  if (typeof (globalThis as any).vi !== 'undefined' && (globalThis as any).vi.clearAllMocks) {
    return (globalThis as any).vi.clearAllMocks();
  }

  // Bun: restore all stubs
  for (const [key, original] of globalStubs) {
    (globalThis as any)[key] = original;
  }
  globalStubs.clear();
  mockStack.forEach((m) => (m.calls.length = 0));
}

/**
 * Restore all mocks. Alias for clearAllMocks in Bun; vi.restoreAllMocks() in Vitest.
 */
export function restoreAllMocks(): void {
  if (typeof (globalThis as any).vi !== 'undefined' && (globalThis as any).vi.restoreAllMocks) {
    return (globalThis as any).vi.restoreAllMocks();
  }
  clearAllMocks();
}

/**
 * Reset all mocks (clear call history). No-op in Bun if no mocks are tracked.
 */
export function resetAllMocks(): void {
  if (typeof (globalThis as any).vi !== 'undefined' && (globalThis as any).vi.resetAllMocks) {
    return (globalThis as any).vi.resetAllMocks();
  }
  mockStack.forEach((m) => (m.calls.length = 0));
}

/**
 * Use real timers. Vitest only; no-op in Bun.
 */
export function useRealTimers(): void {
  if (typeof (globalThis as any).vi !== 'undefined' && (globalThis as any).vi.useRealTimers) {
    return (globalThis as any).vi.useRealTimers();
  }
  // Bun: no timer control, already native
}

/**
 * Restore all global stubs. In Vitest, uses vi.unstubAllGlobals(). In Bun, clears stubs.
 */
export function unstubAllGlobals(): void {
  if (typeof (globalThis as any).vi !== 'undefined' && (globalThis as any).vi.unstubAllGlobals) {
    return (globalThis as any).vi.unstubAllGlobals();
  }
  // Bun: clear all stubs
  for (const [key, original] of globalStubs) {
    (globalThis as any)[key] = original;
  }
  globalStubs.clear();
}

// Mock tracking for Bun
const mockStack: Array<{ calls: any[][] }> = [];
const globalStubs = new Map<string, any>();

/**
 * Create a mock function compatible with both Vitest and Bun.
 * In Vitest, delegates to vi.fn(). In Bun, provides basic tracking.
 */
export function createMockFn<T extends (...args: any[]) => any>(implementation?: T): any {
  // Check if vi is available (Vitest)
  if (typeof (globalThis as any).vi !== 'undefined' && (globalThis as any).vi.fn) {
    return (globalThis as any).vi.fn(implementation);
  }

  // Bun fallback: basic mock
  const calls: any[][] = [];
  const mock = function (...args: any[]) {
    calls.push(args);
    return implementation?.(...args);
  };

  (mock as any).mock = { calls };
  mockStack.push({ calls });
  return mock;
}

/**
 * Stub a global variable. In Vitest, uses vi.stubGlobal(). In Bun, sets directly.
 */
export function stubGlobal<K extends keyof typeof globalThis>(key: K, value: unknown): void {
  if (typeof (globalThis as any).vi !== 'undefined' && (globalThis as any).vi.stubGlobal) {
    return (globalThis as any).vi.stubGlobal(key, value);
  }

  // Bun: save original and set
  if (!globalStubs.has(key as string)) {
    globalStubs.set(key as string, (globalThis as any)[key]);
  }
  (globalThis as any)[key] = value;
}

/**
 * Clear all mocks and stubs. In Vitest, uses vi.clearAllMocks(). In Bun, resets stubs.
 */
export function clearAllMocks(): void {
  if (typeof (globalThis as any).vi !== 'undefined' && (globalThis as any).vi.clearAllMocks) {
    return (globalThis as any).vi.clearAllMocks();
  }

  // Bun: restore all stubs
  for (const [key, original] of globalStubs) {
    (globalThis as any)[key] = original;
  }
  globalStubs.clear();
  mockStack.forEach((m) => (m.calls.length = 0));
}

/**
 * Restore all mocks. Alias for clearAllMocks in Bun; vi.restoreAllMocks() in Vitest.
 */
export function restoreAllMocks(): void {
  if (typeof (globalThis as any).vi !== 'undefined' && (globalThis as any).vi.restoreAllMocks) {
    return (globalThis as any).vi.restoreAllMocks();
  }
  clearAllMocks();
}

/**
 * Reset all mocks (clear call history). No-op in Bun if no mocks are tracked.
 */
export function resetAllMocks(): void {
  if (typeof (globalThis as any).vi !== 'undefined' && (globalThis as any).vi.resetAllMocks) {
    return (globalThis as any).vi.resetAllMocks();
  }
  mockStack.forEach((m) => (m.calls.length = 0));
}

/**
 * Use real timers. Vitest only; no-op in Bun.
 */
export function useRealTimers(): void {
  if (typeof (globalThis as any).vi !== 'undefined' && (globalThis as any).vi.useRealTimers) {
    return (globalThis as any).vi.useRealTimers();
  }
  // Bun: no timer control, already native
}
