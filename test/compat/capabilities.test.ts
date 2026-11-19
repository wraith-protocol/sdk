import { describe, expect, test } from 'vitest';
import {
  assertRuntimeCapabilities,
  detectRuntimeCapabilities,
  DEFAULT_RUNTIME_CAPABILITIES,
} from '../../src/compat/capabilities';
import { UnsupportedCapabilityError, WraithError } from '../../src/errors';

describe('runtime capabilities', () => {
  test('detects the default web APIs on the test runtime', () => {
    const report = detectRuntimeCapabilities();
    expect(report.available).toEqual([...DEFAULT_RUNTIME_CAPABILITIES]);
    expect(report.missing).toEqual([]);
  });

  test('assertRuntimeCapabilities passes when every capability is present', () => {
    expect(() => assertRuntimeCapabilities()).not.toThrow();
  });

  test('reports unknown capabilities as missing without polyfilling them', () => {
    expect(detectRuntimeCapabilities(['edge-smoke/missing'])).toEqual({
      available: [],
      missing: ['edge-smoke/missing'],
    });
  });

  test('throws a typed, actionable error for a missing capability', () => {
    try {
      assertRuntimeCapabilities(['edge-smoke/missing']);
      throw new Error('expected assertRuntimeCapabilities to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedCapabilityError);
      expect(error).toBeInstanceOf(WraithError);
      expect(error.code).toBe('WRAITH/COMPAT/UNSUPPORTED_CAPABILITY');
      expect(error.capabilities).toEqual(['edge-smoke/missing']);
      expect(error.message).toContain('edge-smoke/missing');
      expect(error.describe()).toContain('COMPAT.md');
      expect(error.toJSON()).toMatchObject({
        name: 'UnsupportedCapabilityError',
        code: 'WRAITH/COMPAT/UNSUPPORTED_CAPABILITY',
      });
    }
  });
});
