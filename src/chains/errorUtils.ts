import { redactString, redactValue } from '../redaction';

/**
 * Extracts a safe, human-readable message from an unknown thrown value.
 *
 * Handles the common non-Error throw cases (string, plain object, etc.)
 * so callers never assume `.message` exists, and applies the central
 * redaction policy so secrets and credentials do not leak into UI state.
 */
export function getUnknownErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return redactString(err.message);
  }
  if (typeof err === 'string') {
    return redactString(err);
  }
  try {
    return redactString(JSON.stringify(redactValue(err)));
  } catch {
    return redactString(String(err));
  }
}

/**
 * Returns `true` when a thrown value is a cancellation.
 *
 * Both `DOMException` aborts from `AbortSignal` and errors whose `name` is
 * `AbortError` (some runtimes and libraries re-create the error) are treated
 * as cancellation, so framework adapters can skip error state for work that
 * was deliberately aborted.
 */
export function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
  );
}
