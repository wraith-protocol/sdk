/**
 * Extracts a safe, human-readable message from an unknown thrown value.
 *
 * Handles the common non-Error throw cases (string, plain object, etc.)
 * so callers never assume `.message` exists.
 */
export function getUnknownErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
