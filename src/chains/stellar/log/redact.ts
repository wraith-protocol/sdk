import { sha256 } from '@noble/hashes/sha256';
import { META_ADDRESS_PREFIX } from '../constants';
import { bytesToHex } from '../utils';

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/** Base32 alphabet used by Stellar strkey-encoded identifiers. */
const STRKEY_ALPHABET = 'A-Z2-7';

/** Maps a Stellar strkey's leading character to a human-readable identifier kind. */
const STRKEY_KIND_BY_PREFIX: Record<string, string> = {
  G: 'account',
  S: 'secret',
  C: 'contract',
  T: 'preauth',
  X: 'hashx',
  L: 'pool',
};

/** Matches Wraith Stellar stealth meta-addresses, e.g. `st:xlm:<128 hex chars>`. */
const META_ADDRESS_RE = new RegExp(`${escapeRegExp(META_ADDRESS_PREFIX)}[0-9a-fA-F]{128}`, 'g');

/** Matches 69-char muxed Stellar accounts (`M...`). */
const MUXED_ACCOUNT_RE = new RegExp(`\\bM[${STRKEY_ALPHABET}]{68}\\b`, 'g');

/**
 * Matches 56-char Stellar strkeys: accounts (`G`), secret seeds (`S`),
 * Soroban contract IDs (`C`), pre-auth tx hashes (`T`), hashx signers (`X`),
 * and liquidity pool IDs (`L`).
 */
const STRKEY_RE = new RegExp(
  `\\b[${Object.keys(STRKEY_KIND_BY_PREFIX).join('')}][${STRKEY_ALPHABET}]{55}\\b`,
  'g',
);

/** Matches 32-byte hex blobs: transaction hashes, ephemeral public keys, wasm hashes. */
const HEX_BLOB_RE = /\b(?:0x)?[0-9a-fA-F]{64}\b/g;

// ---------------------------------------------------------------------------
// Pseudonymization
// ---------------------------------------------------------------------------

const ALIAS_HEX_LENGTH = 10;
const textEncoder = new TextEncoder();

/**
 * Derives a stable, non-reversible alias for an identifier.
 *
 * Hashing (rather than a lookup table) means the same identifier always
 * redacts to the same alias — across calls, and across processes — without
 * needing any shared state.
 */
function pseudonymize(kind: string, value: string): string {
  const digest = sha256(textEncoder.encode(`wraith:redact:v1:${kind}:${value}`));
  return `[redact:${kind}:${bytesToHex(digest).slice(0, ALIAS_HEX_LENGTH)}]`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Redacts common Stellar identifiers from a block of text, replacing each
 * with a stable pseudonym.
 *
 * Handles stealth meta-addresses (`st:xlm:...`), Stellar strkeys (accounts,
 * secrets, Soroban contract IDs, pre-auth tx hashes, hashx signers, and
 * liquidity pool IDs), muxed accounts, and 32-byte hex blobs such as
 * transaction hashes and ephemeral public keys.
 *
 * The same identifier always redacts to the same alias, so redacted logs
 * still let you correlate repeated occurrences of the same address or hash
 * without revealing what it is.
 *
 * @param text - Arbitrary log text that may contain Stellar identifiers.
 * @returns The text with every recognized identifier replaced by an alias.
 *
 * @example
 * ```ts
 * import { redact } from "@wraith-protocol/sdk/chains/stellar";
 *
 * redact("scanning st:xlm:" + "ab".repeat(64));
 * // => "scanning [redact:meta:<hash>]"
 * ```
 */
export function redact(text: string): string {
  let redacted = text;
  redacted = redacted.replace(META_ADDRESS_RE, (match) => pseudonymize('meta', match));
  redacted = redacted.replace(MUXED_ACCOUNT_RE, (match) => pseudonymize('muxed', match));
  redacted = redacted.replace(STRKEY_RE, (match) =>
    pseudonymize(STRKEY_KIND_BY_PREFIX[match[0]] ?? 'id', match),
  );
  redacted = redacted.replace(HEX_BLOB_RE, (match) => pseudonymize('hash', match));
  return redacted;
}

// ---------------------------------------------------------------------------
// Vitest reporter
// ---------------------------------------------------------------------------

/** Minimal shape of a Vitest `UserConsoleLog` — only the field we redact. */
interface RedactableConsoleLog {
  content: string;
}

/** Minimal shape of a Vitest `TestError` / `SerializedError` — only the fields we redact. */
interface RedactableError {
  message?: string;
  stack?: string;
  diff?: string;
  actual?: string;
  expected?: string;
  cause?: RedactableError;
  [key: string]: unknown;
}

/** Minimal shape of a Vitest `TestCase` / `TestSuite` — only what we need to reach its errors. */
interface RedactableTaskResult {
  result?: () => { errors?: readonly RedactableError[] } | undefined;
}

function redactErrorInPlace(error: RedactableError | undefined): void {
  if (!error) return;
  if (typeof error.message === 'string') error.message = redact(error.message);
  if (typeof error.stack === 'string') error.stack = redact(error.stack);
  if (typeof error.diff === 'string') error.diff = redact(error.diff);
  if (typeof error.actual === 'string') error.actual = redact(error.actual);
  if (typeof error.expected === 'string') error.expected = redact(error.expected);
  redactErrorInPlace(error.cause);
}

/**
 * Vitest reporter that redacts Stellar identifiers from failure output.
 *
 * Register it alongside your normal reporter, listed *before* it, so the
 * redaction runs before anything is printed:
 *
 * ```ts
 * // vitest.config.ts
 * import { RedactingReporter } from "@wraith-protocol/sdk/chains/stellar";
 *
 * export default defineConfig({
 *   test: { reporters: [new RedactingReporter(), "default"] },
 * });
 * ```
 *
 * This has no dependency on the `vitest` package — it only relies on the
 * shape of the objects Vitest passes to reporter hooks — so it is safe to
 * import outside of a Vitest process.
 */
export class RedactingReporter {
  onTestCaseResult(testCase: RedactableTaskResult): void {
    for (const error of testCase.result?.()?.errors ?? []) {
      redactErrorInPlace(error);
    }
  }

  onTestSuiteResult(testSuite: RedactableTaskResult): void {
    for (const error of testSuite.result?.()?.errors ?? []) {
      redactErrorInPlace(error);
    }
  }

  onTestRunEnd(_testModules: unknown, unhandledErrors?: readonly RedactableError[]): void {
    for (const error of unhandledErrors ?? []) {
      redactErrorInPlace(error);
    }
  }

  onUserConsoleLog(log: RedactableConsoleLog): void {
    if (typeof log?.content === 'string') {
      log.content = redact(log.content);
    }
  }
}
