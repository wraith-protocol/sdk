/**
 * Placeholder emitted when a sensitive key, credential, signature, envelope,
 * or metadata payload is removed by the central SDK redaction policy.
 */
export const REDACTED_VALUE = '[REDACTED]';

/**
 * Configuration options for the central secret redaction policy.
 */
export interface RedactionOptions {
  /** Replacement marker for redacted values. Defaults to {@link REDACTED_VALUE}. */
  placeholder?: string;
  /** Maximum object traversal depth before nested values collapse to `[MaxDepth]`. Defaults to `8`. */
  maxDepth?: number;
}

/**
 * Safe serialized error representation guaranteed to contain only operational
 * diagnostics with secrets, credentials, envelopes, and sensitive metadata removed.
 */
export interface SafeErrorSnapshot {
  name: string;
  message: string;
  code?: string;
  docsLink?: string;
  context?: Record<string, unknown>;
}

const DEFAULT_MAX_DEPTH = 8;

const PUBLIC_HEX_FIELD_RE =
  /^(?:txhash|transactionhash|blockhash|(?:ephemeral|spending|viewing|stealth)?pubkey(?:hex)?|publickey|metaaddress|stealthaddress)$/;

const SENSITIVE_EXACT = new Set(
  'viewingkey spendingkey spendingscalar viewingscalar stealthprivatekey stealthprivatescalar privatekey privkey secretkey ephemeralseed sharedsecret hashscalar scalar seed secretseed mnemonic seedphrase recoveryphrase signature sig signedmessage rawsignature apikey xaikey xapikey authorization proxyauthorization bearer bearertoken token accesstoken refreshtoken idtoken authtoken sessiontoken clientsecret secret password passphrase pin cookie setcookie credential credentials ciphertext checkciphertext iv checkiv salt authtag encryptedkey envelope metadata decryptedmetadata jwt auth key'.split(
    ' ',
  ),
);

const SENSITIVE_TOKEN_SET = new Set(
  'secret private passphrase password mnemonic ciphertext signature authorization bearer credential credentials seed scalar'.split(
    ' ',
  ),
);

const SENSITIVE_KEY_PREFIX_SET = new Set(
  'viewing spending api ai auth encrypted signing'.split(' '),
);

function normKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveName(fieldName: string, isQueryParam: boolean): boolean {
  if (!fieldName) return false;
  const leafRaw = fieldName.includes('.')
    ? fieldName.slice(fieldName.lastIndexOf('.') + 1)
    : fieldName;
  const leaf = normKey(leafRaw);
  if (!leaf || leaf === 'tokens' || PUBLIC_HEX_FIELD_RE.test(leaf)) return false;
  if (!isQueryParam && (leaf === 'key' || leaf === 'auth')) return false;
  if (SENSITIVE_EXACT.has(leaf) || SENSITIVE_EXACT.has(normKey(fieldName))) return true;

  const tokens = leafRaw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.includes('pubkey') || (tokens.includes('public') && tokens.includes('key'))) {
    return false;
  }
  for (const t of tokens) {
    if (SENSITIVE_TOKEN_SET.has(t)) return true;
  }
  const last = tokens[tokens.length - 1];
  if (last === 'token' || last === 'metadata' || last === 'envelope') return true;
  return last === 'key' && tokens.some((t) => SENSITIVE_KEY_PREFIX_SET.has(t));
}

/**
 * Returns `true` when `fieldName` identifies secret cryptographic material,
 * credentials, signatures, encrypted vault envelopes, or sensitive metadata.
 */
export function isSensitiveFieldName(fieldName: string): boolean {
  return isSensitiveName(fieldName, false);
}

function redactParams(segment: string, placeholder: string): string {
  if (!segment) return segment;
  return segment
    .split('&')
    .map((part) => {
      const eq = part.indexOf('=');
      if (eq <= 0) return part;
      const rawName = part.slice(0, eq);
      let decodedName = rawName;
      try {
        decodedName = decodeURIComponent(rawName);
      } catch {
        // Ignore malformed percent-encoding.
      }
      if (isSensitiveName(decodedName, true)) {
        return `${rawName}=${placeholder}`;
      }
      const rawVal = part.slice(eq + 1);
      let decodedVal = rawVal;
      try {
        decodedVal = decodeURIComponent(rawVal);
      } catch {
        // Ignore malformed percent-encoding.
      }
      const cleaned = redactString(decodedVal, { placeholder });
      return cleaned === decodedVal ? part : `${rawName}=${cleaned}`;
    })
    .join('&');
}

/**
 * Redacts userinfo credentials, sensitive query/fragment parameters, and
 * explicit credential path segments from an HTTP(S)/WS(S) URL or relative path
 * while preserving the origin, port, route, and non-sensitive query parameters.
 */
export function redactUrl(url: string, placeholder: string = REDACTED_VALUE): string {
  if (!url) return url;
  let working = url;
  let hashPart = '';
  const hashIdx = working.indexOf('#');
  if (hashIdx !== -1) {
    hashPart = working.slice(hashIdx + 1);
    working = working.slice(0, hashIdx);
  }
  let queryPart = '';
  const queryIdx = working.indexOf('?');
  if (queryIdx !== -1) {
    queryPart = working.slice(queryIdx + 1);
    working = working.slice(0, queryIdx);
  }
  working = working
    .replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/@\s]+)@/, `$1${placeholder}@`)
    .replace(
      /(\/(?:x[-_])?api[-_]?key\/|\/(?:access[-_]?|auth[-_]?)?token\/|\/secret\/)([^/?#\s]+)/gi,
      `$1${placeholder}`,
    );
  const safeQuery = queryPart ? `?${redactParams(queryPart, placeholder)}` : '';
  const safeHash = hashPart
    ? `#${hashPart.includes('=') ? redactParams(hashPart, placeholder) : redactString(hashPart, { placeholder })}`
    : '';
  return `${working}${safeQuery}${safeHash}`;
}

const PEM_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const META_ADDR_RE = /\bst:[a-z0-9]+:(?:0x)?[0-9a-fA-F]{6,140}\b/g;
const PUBLIC_HEX_INLINE_RE =
  /\b(?:txHash|tx|transactionHash|blockHash|(?:ephemeral|spending|viewing|stealth)?PubKey|publicKey|pubKey)\s*[:=]\s*["']?(?:0x)?[0-9a-fA-F]{64,66}["']?/g;
const URL_RE = /\b(?:https?|wss?):\/\/[^\s"'<>]+/gi;
const AUTH_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,}/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const API_PREFIX_RE =
  /\b(?:wraith_(?:live_|test_|secret_|key_)?[A-Za-z0-9_-]{6,}|sk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{8,}|rk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g;
const STELLAR_SEED_RE = /\bS[A-Z2-7]{55}\b/g;
const SOLANA_SECRET_RE = /\b[1-9A-HJ-NP-Za-km-z]{86,88}\b/g;
const INLINE_ERR_SECRET_RE =
  /(Invalid (?:signature length or format|cryptographic scalar):\s*")([^"]*)(")/g;
const MNEMONIC_INLINE_RE =
  /(\b(?:mnemonic|(?:seed|recovery)[_-]?phrase)\s*[:=]\s*)(?:[a-z]{3,10}\s+){11,23}[a-z]{3,10}\b/gi;

const SECRET_LABEL_SRC =
  '(?:viewing|spending|private|secret)[_-]?key(?:[_-]?hex)?|(?:spending|viewing)[_-]?scalar(?:[_-]?hex)?|stealth[_-]?private[_-]?(?:key|scalar)|shared[_-]?secret|ephemeral[_-]?seed|signature(?:[_-]?hex)?|mnemonic|(?:seed|recovery)[_-]?phrase|(?:secret[_-]?)?seed|passphrase|password|(?:x-)?a(?:p)?i-?key|(?:access|refresh|auth|bearer|session)[_-]?token|client[_-]?secret|authorization|(?:check[_-]?)?(?:ciphertext|iv)|salt|auth[_-]?tag|encrypted[_-]?(?:key|payload|envelope)|(?:decrypted|payment|secret)[_-]?metadata|metadata|secret|token';

const QUOTED_SECRET_RE = new RegExp(
  `(["']?(?:${SECRET_LABEL_SRC})["']?\\s*[:=]\\s*)(["'])([^"']*?)\\2`,
  'gi',
);
const UNQUOTED_SECRET_RE = new RegExp(
  `(\\b(?:${SECRET_LABEL_SRC})\\s*[:=]\\s*)(\\[[^\\]\\s]+\\]|[^\\s"',;}\\])]+)`,
  'gi',
);
const HEX_SIG_RE = /\b(?:0x)?[0-9a-fA-F]{128,130}\b/g;
const HEX_PRIV_RE = /\b0x[0-9a-fA-F]{64}\b/g;

/**
 * Deterministically redacts secrets, seeds, signatures, bearer tokens, RPC URL
 * credentials, encrypted envelope fields, and sensitive metadata from a string.
 */
export function redactString(input: string, options: RedactionOptions = {}): string {
  if (!input) return input;
  const placeholder = options.placeholder ?? REDACTED_VALUE;
  const preserved: string[] = [];
  const mask = (m: string): string => `\uE000${preserved.push(m) - 1}\uE001`;

  let out = input.replace(META_ADDR_RE, mask).replace(PUBLIC_HEX_INLINE_RE, mask);
  out = out.replace(PEM_RE, placeholder);
  out = out.replace(URL_RE, (rawUrl) => {
    const trail = rawUrl.match(/[.,;:!?)\]}]+$/)?.[0] ?? '';
    const core = trail ? rawUrl.slice(0, -trail.length) : rawUrl;
    return `${redactUrl(core, placeholder)}${trail}`;
  });
  if (
    out.startsWith('/') &&
    (out.includes('?') || out.includes('/api-key/') || out.includes('/token/'))
  ) {
    out = redactUrl(out, placeholder);
  }
  out = out
    .replace(AUTH_RE, (_m, scheme: string) => `${scheme} ${placeholder}`)
    .replace(JWT_RE, placeholder)
    .replace(API_PREFIX_RE, placeholder)
    .replace(STELLAR_SEED_RE, placeholder)
    .replace(SOLANA_SECRET_RE, placeholder)
    .replace(INLINE_ERR_SECRET_RE, `$1${placeholder}$3`)
    .replace(QUOTED_SECRET_RE, `$1$2${placeholder}$2`)
    .replace(MNEMONIC_INLINE_RE, `$1${placeholder}`)
    .replace(UNQUOTED_SECRET_RE, `$1${placeholder}`)
    .replace(HEX_SIG_RE, placeholder)
    .replace(HEX_PRIV_RE, placeholder);

  if (preserved.length > 0) {
    out = out.replace(/\uE000(\d+)\uE001/g, (_m, idx: string) => preserved[Number(idx)] ?? '');
  }
  return out;
}

function redactInternal(
  value: unknown,
  placeholder: string,
  maxDepth: number,
  depth: number,
  seen: WeakSet<object>,
  parentKey?: string,
): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol' || typeof value === 'function') return String(value);
  if (typeof value === 'string') {
    const pk = parentKey ? normKey(parentKey) : '';
    if (pk && (PUBLIC_HEX_FIELD_RE.test(pk) || pk === 'url' || pk === 'endpoint')) {
      return redactUrl(value, placeholder);
    }
    return redactString(value, { placeholder, maxDepth });
  }
  if (value instanceof Uint8Array) return `[Uint8Array(${value.byteLength})]`;
  if (typeof ArrayBuffer !== 'undefined') {
    if (value instanceof ArrayBuffer) return `[ArrayBuffer(${value.byteLength})]`;
    if (ArrayBuffer.isView(value)) return `[ArrayBufferView(${value.byteLength})]`;
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return redactError(value, { placeholder, maxDepth });
  if (typeof value !== 'object') return redactString(String(value), { placeholder, maxDepth });

  if (seen.has(value)) return '[Circular]';
  if (depth >= maxDepth) return '[MaxDepth]';

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) =>
        redactInternal(entry, placeholder, maxDepth, depth + 1, seen, parentKey),
      );
    }
    const record = value as Record<string, unknown>;
    const vt = record.__vaultType;
    if (
      (vt === 'Uint8Array' || vt === 'ArrayBuffer' || vt === 'bigint' || vt === 'Date') &&
      'data' in record
    ) {
      return { __vaultType: vt, data: placeholder };
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      out[key] =
        item === undefined
          ? undefined
          : isSensitiveName(key, false)
            ? placeholder
            : redactInternal(item, placeholder, maxDepth, depth + 1, seen, key);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/**
 * Recursively redacts sensitive fields and embedded secret patterns across
 * objects, arrays, strings, binary buffers, vault envelopes, and errors.
 */
export function redactValue<T = unknown>(value: T, options: RedactionOptions = {}): unknown {
  return redactInternal(
    value,
    options.placeholder ?? REDACTED_VALUE,
    options.maxDepth ?? DEFAULT_MAX_DEPTH,
    0,
    new WeakSet<object>(),
  );
}

/**
 * Produces a deterministic, secret-free {@link SafeErrorSnapshot} suitable for
 * JSON serialization, structured logging, and error reporting.
 */
export function redactError(error: unknown, options: RedactionOptions = {}): SafeErrorSnapshot {
  const placeholder = options.placeholder ?? REDACTED_VALUE;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

  if (error instanceof Error) {
    const typed = error as Error & { code?: unknown; docsLink?: unknown; context?: unknown };
    const snapshot: SafeErrorSnapshot = {
      name: redactString(error.name || 'Error', { placeholder, maxDepth }),
      message: redactString(error.message || '', { placeholder, maxDepth }),
    };
    if (typeof typed.code === 'string') snapshot.code = typed.code;
    if (typeof typed.docsLink === 'string')
      snapshot.docsLink = redactUrl(typed.docsLink, placeholder);
    if (
      typed.context !== undefined &&
      typed.context !== null &&
      typeof typed.context === 'object'
    ) {
      snapshot.context = redactInternal(
        typed.context,
        placeholder,
        maxDepth,
        0,
        new WeakSet<object>(),
      ) as Record<string, unknown>;
    }
    return snapshot;
  }

  if (typeof error === 'string') {
    return { name: 'Error', message: redactString(error, { placeholder, maxDepth }) };
  }

  if (error !== null && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    let rawMessage: string;
    if (typeof obj.message === 'string') {
      rawMessage = obj.message;
    } else {
      try {
        rawMessage = JSON.stringify(redactValue(error, { placeholder, maxDepth }));
      } catch {
        rawMessage = String(error);
      }
    }
    const snapshot: SafeErrorSnapshot = {
      name: redactString(typeof obj.name === 'string' && obj.name ? obj.name : 'Error', {
        placeholder,
        maxDepth,
      }),
      message: redactString(rawMessage, { placeholder, maxDepth }),
    };
    if (typeof obj.code === 'string') snapshot.code = obj.code;
    return snapshot;
  }

  return { name: 'Error', message: redactString(String(error), { placeholder, maxDepth }) };
}

/**
 * Sanitizes a single telemetry span attribute value so user-provided hooks
 * receive only primitive `string | number | boolean` values with secrets removed.
 */
export function sanitizeTelemetryAttributeValue(
  key: string,
  value: unknown,
  options: RedactionOptions = {},
): string | number | boolean {
  const placeholder = options.placeholder ?? REDACTED_VALUE;
  if (isSensitiveName(key, false)) return placeholder;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'string') {
    return PUBLIC_HEX_FIELD_RE.test(normKey(key))
      ? redactUrl(value, placeholder)
      : redactString(value, options);
  }
  if (
    value instanceof Uint8Array ||
    (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer)
  ) {
    return placeholder;
  }
  try {
    return JSON.stringify(redactValue(value, options));
  } catch {
    return redactString(String(value), options);
  }
}

/**
 * Sanitizes initial telemetry span attributes into the documented safe shape.
 */
export function sanitizeTelemetryAttributes(
  attributes: Record<string, string | number | boolean> | undefined,
  options: RedactionOptions = {},
): Record<string, string | number | boolean> | undefined {
  if (attributes === undefined) return undefined;
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (key) safe[key] = sanitizeTelemetryAttributeValue(key, value, options);
  }
  return safe;
}

/**
 * Sanitizes a thrown value before passing it to `Span.recordException` so
 * user-provided telemetry hooks receive only a clean `Error` with the
 * documented safe shape.
 */
export function sanitizeTelemetryException(error: unknown, options: RedactionOptions = {}): Error {
  const snapshot = redactError(error, options);
  const safeError = new Error(snapshot.message);
  if (
    snapshot.name !== 'Error' ||
    (error instanceof Error && Object.prototype.hasOwnProperty.call(error, 'name'))
  ) {
    safeError.name = snapshot.name;
  }
  if (error instanceof Error && typeof error.stack === 'string') {
    safeError.stack = redactString(error.stack, options);
  }
  for (const field of ['code', 'docsLink', 'context'] as const) {
    if (snapshot[field] !== undefined) {
      Object.defineProperty(safeError, field, {
        value: snapshot[field],
        enumerable: true,
        configurable: true,
      });
    }
  }
  return safeError;
}
