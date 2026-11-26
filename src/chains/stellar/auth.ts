import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import {
  checkDomainGuards,
  encodeDomainAuthorizationBytes,
  type SignatureDomain,
  type SignatureVerificationResult,
  type VerifyDomainOptions,
} from '../../auth/domain';
import { signWithScalar } from './scalar';

/** Computes the 32-byte SHA-256 digest for a domain-separated Stellar authorization. */
export function computeStellarAuthorizationDigest(
  domain: SignatureDomain,
  payloadBytes: Uint8Array,
): Uint8Array {
  if (domain.chain !== 'stellar') {
    throw new TypeError(`Expected Stellar domain, got "${domain.chain}"`);
  }
  return sha256(encodeDomainAuthorizationBytes(domain, payloadBytes));
}

/**
 * Signs a domain-separated Stellar authorization with either a 32-byte ed25519
 * seed (`Uint8Array`) or a derived stealth private scalar (`bigint` + `publicKeyBytes`).
 */
export function signStellarDomainAuthorization(
  domain: SignatureDomain,
  payloadBytes: Uint8Array,
  secretKeyOrScalar: Uint8Array | bigint,
  publicKeyBytes?: Uint8Array,
): Uint8Array {
  const digest = computeStellarAuthorizationDigest(domain, payloadBytes);
  if (typeof secretKeyOrScalar === 'bigint') {
    if (!publicKeyBytes || publicKeyBytes.length !== 32) {
      throw new TypeError('publicKeyBytes (32 bytes) is required when signing with a scalar');
    }
    return signWithScalar(digest, secretKeyOrScalar, publicKeyBytes);
  }
  return ed25519.sign(digest, secretKeyOrScalar);
}

/** Verifies a domain-separated Stellar ed25519 authorization and records its nonce. */
export function verifyStellarDomainAuthorization(
  signature: Uint8Array,
  signedDomain: SignatureDomain,
  payloadBytes: Uint8Array,
  publicKeyBytes: Uint8Array,
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
    if (signature.length !== 64 || publicKeyBytes.length !== 32) {
      return { valid: false, reason: 'INVALID_SIGNATURE' };
    }
    const digest = computeStellarAuthorizationDigest(signedDomain, payloadBytes);
    if (!ed25519.verify(signature, digest, publicKeyBytes)) {
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
