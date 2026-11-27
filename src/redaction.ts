/** Stable marker used whenever a value is intentionally removed from diagnostics. */
export const REDACTED = '[REDACTED]';

const SENSITIVE_KEY =
  /(?:pass(?:word|phrase)?|secret|private|seed|mnemonic|scalar|signature|token|authorization|api[-_]?key|viewing[-_]?key|spending[-_]?key|credential|cookie|ciphertext|plaintext|salt|\biv\b|authTag|checkIv|checkCiphertext|decrypted|rawMetadata|metadata)/iu;

export function isSensitiveFieldName(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function redactUrl(value: string): string {
  return value
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/giu, `$1${REDACTED}:${REDACTED}@`)
    .replace(
      /([?#&](?:api[-_]?key|access[-_]?token|token|secret|credential)[^=]*=)[^&#\s]*/giu,
      `$1${REDACTED}`,
    );
}

export function redactText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, `Bearer ${REDACTED}`)
    .replace(/Basic\s+[A-Za-z0-9._~+/=-]+/giu, `Basic ${REDACTED}`)
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gu, REDACTED)
    .replace(/https?:\/\/[^\s)]+/giu, (url) => redactUrl(url))
    .replace(/(?:api[-_]?key|access[-_]?token|client[-_]?secret)\s*[:=]\s*[^\s,;]+/giu, (match) =>
      match.replace(/[:=]\s*[^\s,;]+$/u, `=${REDACTED}`),
    );
}

export function redact(value: unknown, key?: string, seen = new WeakSet<object>()): unknown {
  if (key && isSensitiveFieldName(key)) return REDACTED;
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'bigint') return value.toString();
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (value instanceof Error) return { name: value.name, message: redactText(value.message) };
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redact(item, undefined, seen));
  const output: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value))
    output[entryKey] = redact(entryValue, entryKey, seen);
  return output;
}

export interface SafeTelemetryException {
  name: string;
  message: string;
  code?: string;
}

export function redactException(error: unknown): SafeTelemetryException {
  if (error instanceof Error) {
    const code =
      'code' in error && typeof (error as Error & { code?: unknown }).code === 'string'
        ? (error as Error & { code: string }).code
        : undefined;
    return { name: error.name, message: redactText(error.message), ...(code ? { code } : {}) };
  }
  return { name: 'Error', message: redactText(String(error)) };
}

export function redactAttributes(
  attributes?: Record<string, unknown>,
): Record<string, string | number | boolean> | undefined {
  if (!attributes) return undefined;
  const safe = redact(attributes) as Record<string, unknown>;
  const output: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(safe))
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      output[key] = value;
  return output;
}
