import { describe, expect, it } from 'vitest';
import {
  UnsupportedCapabilityError,
  WraithError,
  WraithRuntimeError,
  installReactNativePolyfills,
} from '../../src';
import { KeyVault } from '../../src/vault';
import { checkRuntimeVersion, loadMatrix } from '../../scripts/compat/matrix.mjs';

describe('edge runtime capabilities and matrix', () => {
  it('throws typed actionable UnsupportedCapabilityError when KeyVault lacks browser DOM', () => {
    const savedWindow = globalThis.window;
    const savedDocument = globalThis.document;
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).document;

    try {
      let caught: unknown;
      try {
        new KeyVault();
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(UnsupportedCapabilityError);
      expect(caught).toBeInstanceOf(WraithRuntimeError);
      expect(caught).toBeInstanceOf(WraithError);
      const typed = caught as UnsupportedCapabilityError;
      expect(typed.code).toBe('WRAITH/RUNTIME/UNSUPPORTED_CAPABILITY');
      expect(typed.capability).toBe('window');
      expect(typed.describe()).toContain('Try:');
      expect(typed.describe()).toContain(typed.docsLink);
      expect(typed.toJSON()).toMatchObject({
        name: 'UnsupportedCapabilityError',
        code: 'WRAITH/RUNTIME/UNSUPPORTED_CAPABILITY',
        context: expect.objectContaining({ capability: 'window' }),
      });
    } finally {
      globalThis.window = savedWindow;
      globalThis.document = savedDocument;
    }
  });

  it('throws typed actionable UnsupportedCapabilityError when React Native lacks crypto.getRandomValues', () => {
    const savedCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    try {
      let caught: unknown;
      try {
        installReactNativePolyfills();
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(UnsupportedCapabilityError);
      const typed = caught as UnsupportedCapabilityError;
      expect(typed.code).toBe('WRAITH/RUNTIME/UNSUPPORTED_CAPABILITY');
      expect(typed.capability).toBe('crypto.getRandomValues');
      expect(typed.describe()).toContain('react-native-get-random-values');
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: savedCrypto,
        configurable: true,
        writable: true,
      });
    }
  });

  it('marks Deno 2.x, Cloudflare Workers, and Web Workers as supported in compat/matrix.json', () => {
    const matrix = loadMatrix();
    expect(checkRuntimeVersion(matrix, { id: 'deno', name: 'Deno', version: '2.9.6' })).toEqual({
      supported: true,
      reason: null,
    });
    expect(
      checkRuntimeVersion(matrix, { id: 'deno', name: 'Deno', version: '1.46.0' }).supported,
    ).toBe(false);
    expect(
      checkRuntimeVersion(matrix, {
        id: 'edge',
        name: 'Cloudflare Workers / Vercel Edge',
        version: 'workerd',
      }),
    ).toEqual({ supported: true, reason: null });
    expect(
      checkRuntimeVersion(matrix, {
        id: 'browser-worker',
        name: 'Web Workers (standards-only)',
        version: 'es2022',
      }),
    ).toEqual({ supported: true, reason: null });
  });
});
