import { describe, test, expect } from 'vitest';
import { redact, RedactingReporter } from '../../../../src/chains/stellar/log/redact';

const account = 'G' + 'A'.repeat(55);
const otherAccount = 'G' + 'B'.repeat(55);
const secret = 'S' + 'A'.repeat(55);
const contract = 'C' + 'A'.repeat(55);
const preauth = 'T' + 'A'.repeat(55);
const hashx = 'X' + 'A'.repeat(55);
const pool = 'L' + 'A'.repeat(55);
const muxed = 'M' + 'A'.repeat(68);
const txHash = 'ab'.repeat(32);
const metaAddress = 'st:xlm:' + 'cd'.repeat(64);

describe('redact', () => {
  test('redacts an account strkey', () => {
    const out = redact(`scanning ${account} for payments`);
    expect(out).not.toContain(account);
    expect(out).toMatch(/\[redact:account:[0-9a-f]{10}\]/);
  });

  test('redacts every identifier kind in a canned log', () => {
    const log = [
      `account=${account}`,
      `secret=${secret}`,
      `contract=${contract}`,
      `preauth=${preauth}`,
      `hashx=${hashx}`,
      `pool=${pool}`,
      `muxed=${muxed}`,
      `tx=${txHash}`,
      `meta=${metaAddress}`,
    ].join('\n');

    const out = redact(log);

    for (const identifier of [
      account,
      secret,
      contract,
      preauth,
      hashx,
      pool,
      muxed,
      txHash,
      metaAddress,
    ]) {
      expect(out).not.toContain(identifier);
    }

    expect(out).toMatch(/\[redact:account:[0-9a-f]{10}\]/);
    expect(out).toMatch(/\[redact:secret:[0-9a-f]{10}\]/);
    expect(out).toMatch(/\[redact:contract:[0-9a-f]{10}\]/);
    expect(out).toMatch(/\[redact:preauth:[0-9a-f]{10}\]/);
    expect(out).toMatch(/\[redact:hashx:[0-9a-f]{10}\]/);
    expect(out).toMatch(/\[redact:pool:[0-9a-f]{10}\]/);
    expect(out).toMatch(/\[redact:muxed:[0-9a-f]{10}\]/);
    expect(out).toMatch(/\[redact:hash:[0-9a-f]{10}\]/);
    expect(out).toMatch(/\[redact:meta:[0-9a-f]{10}\]/);
  });

  test('pseudonyms are stable across calls', () => {
    const first = redact(account);
    const second = redact(account);
    expect(first).toBe(second);
  });

  test('different identifiers get different pseudonyms', () => {
    expect(redact(account)).not.toBe(redact(otherAccount));
  });

  test('is idempotent — redacting already-redacted text is a no-op', () => {
    const once = redact(`caller ${account}`);
    const twice = redact(once);
    expect(twice).toBe(once);
  });

  test('leaves non-identifier text untouched', () => {
    const text = 'no secrets here, just a regular log line';
    expect(redact(text)).toBe(text);
  });

  test('does not redact a bare 32-char hex string (too short to be a hash)', () => {
    const shortHex = 'ab'.repeat(16);
    expect(redact(shortHex)).toBe(shortHex);
  });
});

describe('RedactingReporter', () => {
  test('redacts error message, stack, and cause on test case failure', () => {
    const reporter = new RedactingReporter();
    const error = {
      message: `expected ${account}`,
      stack: `Error: mismatch\n    at scan (${txHash})`,
      cause: { message: `nested ${contract}` },
    };
    const testCase = { result: () => ({ errors: [error] }) };

    reporter.onTestCaseResult(testCase);

    expect(error.message).not.toContain(account);
    expect(error.stack).not.toContain(txHash);
    expect(error.cause.message).not.toContain(contract);
  });

  test('redacts suite-level errors', () => {
    const reporter = new RedactingReporter();
    const error = { message: `beforeAll failed for ${account}` };
    const testSuite = { result: () => ({ errors: [error] }) };

    reporter.onTestSuiteResult(testSuite);

    expect(error.message).not.toContain(account);
  });

  test('redacts unhandled errors passed to onTestRunEnd', () => {
    const reporter = new RedactingReporter();
    const error = { message: `unhandled rejection: ${account}` };

    reporter.onTestRunEnd([], [error]);

    expect(error.message).not.toContain(account);
  });

  test('redacts console log content in place', () => {
    const reporter = new RedactingReporter();
    const log = { content: `debug: matched ${account}` };

    reporter.onUserConsoleLog(log);

    expect(log.content).not.toContain(account);
    expect(log.content).toMatch(/\[redact:account:[0-9a-f]{10}\]/);
  });

  test('tolerates a passing test case with no errors', () => {
    const reporter = new RedactingReporter();
    expect(() => reporter.onTestCaseResult({ result: () => ({ errors: [] }) })).not.toThrow();
    expect(() => reporter.onTestCaseResult({ result: () => undefined })).not.toThrow();
  });
});
