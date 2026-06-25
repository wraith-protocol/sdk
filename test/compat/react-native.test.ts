import { describe, expect, it, afterEach } from 'vitest';
import { installReactNativePolyfills } from '../../src/compat/react-native';

describe('installReactNativePolyfills', () => {
  const originalAtob = globalThis.atob;
  const originalBtoa = globalThis.btoa;
  const originalTextEncoder = globalThis.TextEncoder;
  const originalTextDecoder = globalThis.TextDecoder;

  afterEach(() => {
    globalThis.atob = originalAtob;
    globalThis.btoa = originalBtoa;
    globalThis.TextEncoder = originalTextEncoder;
    globalThis.TextDecoder = originalTextDecoder;
  });

  it('provides atob and btoa when missing', () => {
    delete (globalThis as any).atob;
    delete (globalThis as any).btoa;

    expect(globalThis.atob).toBeUndefined();
    expect(globalThis.btoa).toBeUndefined();

    installReactNativePolyfills();

    expect(typeof globalThis.atob).toBe('function');
    expect(typeof globalThis.btoa).toBe('function');
    expect(globalThis.btoa('hello')).toBe('aGVsbG8=');
    expect(globalThis.atob('aGVsbG8=')).toBe('hello');
  });

  it('provides TextEncoder/TextDecoder when missing', () => {
    delete (globalThis as any).TextEncoder;
    delete (globalThis as any).TextDecoder;

    expect(globalThis.TextEncoder).toBeUndefined();
    expect(globalThis.TextDecoder).toBeUndefined();

    installReactNativePolyfills();

    expect(typeof globalThis.TextEncoder).toBe('function');
    expect(typeof globalThis.TextDecoder).toBe('function');

    const encoded = new globalThis.TextEncoder().encode('hello');
    const decoded = new globalThis.TextDecoder().decode(encoded);
    expect(decoded).toBe('hello');
  });
});
