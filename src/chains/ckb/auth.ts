import { secp256k1 } from '@noble/curves/secp256k1';
import { blake2b } from '@noble/hashes/blake2b';
import { toBytes, toHex } from 'viem';
import {
  checkDomainGuards,
  encodeDomainAuthorizationBytes,
  type SignatureDomain,
  type SignatureVerificationResult,
  type VerifyDomainOptions,
} from '../../auth/domain';
import type { HexString } from './types';

const CKB_PERSONALIZATION = new TextEncoder().encode('ckb-default-hash');

/**
 * Computes the 32-byte CKB `blake2b` (`personalization = "ckb-default-hash"`)
 * digest for a domain-separated CKB authorization.
 */
export function computeCkbAuthorizationDigest(
  domain: SignatureDomain,
  payloadBytes: Uint8Array,
): HexString {
  if (domain.chain !== 'ckb') {
    throw new TypeError(`Expected CKB domain, got "${domain.chain}"`);
  }
  const digest = blake2b(encodeDomainAuthorizationBytes(domain, payloadBytes), {
    personalization: CKB_PERSONALIZATION,
    dkLen: 32,
  });
  return toHex(digest) as HexString;
}

/** Signs a domain-separated CKB authorization with a 32-byte secp256k1 private key. */
export function signCkbDomainAuthorization(
  domain: SignatureDomain,
  payloadBytes: Uint8Array,
  privateKey: HexString,
): HexString {
  const digest = computeCkbAuthorizationDigest(domain, payloadBytes);
  const sig = secp256k1.sign(toBytes(digest), toBytes(privateKey).slice(0, 32));
  const r = sig.r.toString(16).padStart(64, '0');
  const s = sig.s.toString(16).padStart(64, '0');
  const recovery = sig.recovery.toString(16).padStart(2, '0');
  return `0x${r}${s}${recovery}` as HexString;
}

/**
 * Verifies a domain-separated CKB recoverable secp256k1 authorization against
 * the expected 33-byte compressed public key and records its nonce.
 */
export function verifyCkbDomainAuthorization(
  signature: HexString,
  signedDomain: SignatureDomain,
  payloadBytes: Uint8Array,
  expectedCompressedPubKey: HexString,
  options: VerifyDomainOptions,
): SignatureVerificationResult {
  let guard: SignatureVerificationResult;
  try {
    guard = checkDomainGuards(signedDomain, options);
  } catch {
    return { valid: false, reason: 'INVALID_SIGNATURE' };
  }
  if (!guard.valid) return guard;

  try {
    const sigBytes = toBytes(signature);
    if (sigBytes.length !== 65) {
      return { valid: false, reason: 'INVALID_SIGNATURE' };
    }
    const recovery = sigBytes[64] >= 27 ? sigBytes[64] - 27 : sigBytes[64];
    if (recovery !== 0 && recovery !== 1) {
      return { valid: false, reason: 'INVALID_SIGNATURE' };
    }
    const digest = computeCkbAuthorizationDigest(signedDomain, payloadBytes);
    const point = secp256k1.Signature.fromCompact(sigBytes.slice(0, 64))
      .addRecoveryBit(recovery)
      .recoverPublicKey(toBytes(digest));

    const recoveredHex = toHex(point.toRawBytes(true)).toLowerCase();
    if (recoveredHex !== expectedCompressedPubKey.toLowerCase()) {
      return { valid: false, reason: 'INVALID_SIGNATURE' };
    }
    if (options.recordNonce !== false) {
      options.usedNonces?.add(signedDomain.nonce);
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: 'INVALID_SIGNATURE' };
  }
}
