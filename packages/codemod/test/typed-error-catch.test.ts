import { describe, expect, test } from 'vitest';
import { applyTransform, loadFixture, loadTransform, normalize } from './helpers.js';

const transform = loadTransform('v1', 'typed-error-catch.cjs');

describe('typed-error-catch', () => {
  test('rewrites .message.includes() checks to instanceof and imports the error classes', () => {
    const input = loadFixture('typed-error-catch', 'input.ts');
    const expected = loadFixture('typed-error-catch', 'output.ts');

    const actual = applyTransform(transform, input);

    expect(normalize(actual)).toBe(normalize(expected));
  });

  test('is idempotent: running the already-migrated output again is a no-op', () => {
    const alreadyMigrated = loadFixture('typed-error-catch', 'output.ts');

    const actual = applyTransform(transform, alreadyMigrated);

    expect(normalize(actual)).toBe(normalize(alreadyMigrated));
  });

  test('leaves files with unrecognized message substrings untouched', () => {
    const input = loadFixture('no-op-file', 'input.ts');

    const actual = applyTransform(transform, input);

    expect(actual).toBe(input);
  });
});
