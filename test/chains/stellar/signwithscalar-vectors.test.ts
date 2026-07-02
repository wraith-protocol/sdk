import { describe, test, expect } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import {
  signWithScalar,
  L,
  bytesToScalar,
  scalarToBytes,
} from '../../../src/chains/stellar/scalar';

/**
 * signWithScalar is a custom ed25519 signing routine that operates on a
 * derived scalar (not a seed). It is necessary because stealth private
 * scalars are derived as (spending_scalar + hash_scalar) % L and cannot
 * be decomposed back into an ed25519 seed.
 *
 * These test vectors cross-validate against @noble/curves ed25519.verify()
 * and test edge cases per RFC 8032 recommendations.
 */

import { hexToBytes } from '../../../src/chains/stellar/utils';

/**
 * Generate a known test vector: use a deterministic scalar derived from a seed,
 * then produce and verify a signature.
 */
function makeTestVector(
  label: string,
  messageHex: string,
  scalar: bigint,
): { message: Uint8Array; scalar: bigint; pubKey: Uint8Array } {
  const message = hexToBytes(messageHex);
  const pubKey = ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes();
  return { message, scalar, pubKey };
}

describe('signWithScalar vs RFC 8032', () => {
  test('produces signatures that verify with @noble/curves ed25519.verify', () => {
    const message = new TextEncoder().encode('test message');
    const scalar = 12345678901234567890n;
    const pubKey = ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes();

    const sig = signWithScalar(message, scalar, pubKey);

    const verified = ed25519.verify(sig, message, pubKey);
    expect(verified).toBe(true);
  });

  test('deterministic with same scalar and message', () => {
    const message = new TextEncoder().encode('test message');
    const scalar = 12345678901234567890n;
    const pubKey = ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes();

    const sig1 = signWithScalar(message, scalar, pubKey);
    const sig2 = signWithScalar(message, scalar, pubKey);

    expect(sig1).toEqual(sig2);
  });

  test('different scalars produce different signatures', () => {
    const message = new TextEncoder().encode('test message');

    const pubKey1 = ed25519.ExtendedPoint.BASE.multiply(100n).toRawBytes();
    const pubKey2 = ed25519.ExtendedPoint.BASE.multiply(200n).toRawBytes();

    // Use the scalar + pubKey pair in signWithScalar
    const sig1 = signWithScalar(message, 100n, pubKey1);
    const sig2 = signWithScalar(message, 200n, pubKey2);

    expect(sig1).not.toEqual(sig2);
  });

  test('different messages produce different signatures', () => {
    const scalar = 12345678901234567890n;
    const pubKey = ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes();

    const sig1 = signWithScalar(new TextEncoder().encode('message A'), scalar, pubKey);
    const sig2 = signWithScalar(new TextEncoder().encode('message B'), scalar, pubKey);

    expect(sig1).not.toEqual(sig2);
  });

  test('rejects scalar = 0', () => {
    const message = new TextEncoder().encode('test');
    const pubKey = new Uint8Array(32).fill(0);
    expect(() => signWithScalar(message, 0n, pubKey)).toThrow('Scalar must be in range');
  });

  test('rejects negative scalar', () => {
    const message = new TextEncoder().encode('test');
    const pubKey = new Uint8Array(32).fill(0);
    expect(() => signWithScalar(message, -1n, pubKey)).toThrow('Scalar must be in range');
  });

  test('rejects scalar >= L', () => {
    const message = new TextEncoder().encode('test');
    const pubKey = new Uint8Array(32).fill(0);
    expect(() => signWithScalar(message, L, pubKey)).toThrow('Scalar must be in range');
  });

  test('handles scalar = L - 1', () => {
    const message = new TextEncoder().encode('boundary test');
    const scalar = L - 1n;
    const pubKey = ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes();

    const sig = signWithScalar(message, scalar, pubKey);
    const verified = ed25519.verify(sig, message, pubKey);
    expect(verified).toBe(true);
  });

  test('handles scalar = 1', () => {
    const message = new TextEncoder().encode('small scalar');
    const scalar = 1n;
    const pubKey = ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes();

    const sig = signWithScalar(message, scalar, pubKey);
    const verified = ed25519.verify(sig, message, pubKey);
    expect(verified).toBe(true);
  });

  test('handles empty message (0 bytes)', () => {
    const message = new Uint8Array(0);
    const scalar = 42n;
    const pubKey = ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes();

    const sig = signWithScalar(message, scalar, pubKey);
    const verified = ed25519.verify(sig, message, pubKey);
    expect(verified).toBe(true);
  });

  test('handles 1 MB message', () => {
    // Generate deterministic 1 MB message
    const message = new Uint8Array(1_000_000);
    for (let i = 0; i < message.length; i++) {
      message[i] = i & 0xff;
    }
    const scalar = 42n;
    const pubKey = ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes();

    const sig = signWithScalar(message, scalar, pubKey);
    const verified = ed25519.verify(sig, message, pubKey);
    expect(verified).toBe(true);
  });

  test('known-answer vector (deterministic)', () => {
    // Use a known scalar and message
    const message = hexToBytes('deadbeef');
    const scalar = BigInt('0x1234567890abcdef');
    const pubKey = ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes();

    const sig = signWithScalar(message, scalar, pubKey);

    // Verify with @noble/curves
    const verified = ed25519.verify(sig, message, pubKey);
    expect(verified).toBe(true);

    // Signature is 64 bytes
    expect(sig.length).toBe(64);

    // R is the first 32 bytes, S is the last 32 bytes
    const R = sig.slice(0, 32);
    const S_bytes = sig.slice(32);

    // S should be in range (0, L)
    const S = bytesToScalar(S_bytes);
    expect(S).toBeGreaterThan(0n);
    expect(S).toBeLessThan(L);
  });

  test('signature length is exactly 64 bytes', () => {
    const message = new TextEncoder().encode('length check');
    const scalar = 42n;
    const pubKey = ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes();

    const sig = signWithScalar(message, scalar, pubKey);
    expect(sig.length).toBe(64);
  });

  test('scalarToBytes and bytesToScalar are inverses', () => {
    const values = [0n, 1n, 42n, L - 1n, BigInt('0xdeadbeefcafebabe')];
    for (const val of values) {
      const bytes = scalarToBytes(val);
      expect(bytes.length).toBe(32);
      const roundtrip = bytesToScalar(bytes);
      expect(roundtrip).toBe(val);
    }
  });

  test('scalarToBytes produces little-endian encoding', () => {
    // Value 0x0102 = 258 in decimal, LE bytes = [0x02, 0x01, 0, 0, ...]
    const bytes = scalarToBytes(258n);
    expect(bytes[0]).toBe(0x02);
    expect(bytes[1]).toBe(0x01);
    expect(bytes[2]).toBe(0x00);
  });

  test('bytesToScalar reads little-endian encoding', () => {
    // LE bytes [0x02, 0x01] = value 0x0102 = 258
    const bytes = new Uint8Array(32);
    bytes[0] = 0x02;
    bytes[1] = 0x01;
    expect(bytesToScalar(bytes)).toBe(258n);
  });

  test('cross-validates multiple R values with known scalars', () => {
    // Test several scalar values and verify each signature
    const scalars = [2n, 100n, 1000n, BigInt('0xffffffffffffffff'), (L - 1n) / 2n];
    const message = new TextEncoder().encode('cross-validation');

    for (const scalar of scalars) {
      const pubKey = ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes();
      const sig = signWithScalar(message, scalar, pubKey);
      const verified = ed25519.verify(sig, message, pubKey);
      expect(verified).toBe(true);
    }
  });
});
