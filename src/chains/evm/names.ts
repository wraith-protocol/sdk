import { secp256k1 } from '@noble/curves/secp256k1';
import {
  encodeAbiParameters,
  encodePacked,
  getAddress,
  keccak256,
  parseAbiParameters,
  toBytes,
  toHex,
} from 'viem';
import {
  checkDomainGuards,
  normalizeDomainContract,
  validateSignatureDomain,
  type SignatureDomain,
  type SignatureVerificationResult,
  type VerifyDomainOptions,
} from '../../auth/domain';
import { InvalidMetaAddressError } from '../../errors';
import type { HexString } from './types';

/** EIP-712 domain typehash binding name, version, chainId, verifyingContract, and network salt. */
export const EVM_DOMAIN_TYPEHASH: HexString = keccak256(
  toBytes(
    'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)',
  ),
) as HexString;

/** EIP-712 struct typehash for domain-separated Wraith name authorizations. */
export const EVM_NAME_AUTH_TYPEHASH: HexString = keccak256(
  toBytes(
    'WraithNameAuthorization(bytes32 operationHash,bytes32 nameHash,bytes32 metaAddressHash,uint256 nonce,uint256 expiry)',
  ),
) as HexString;

const DOMAIN_NAME_HASH = keccak256(toBytes('Wraith Protocol'));
const DOMAIN_VERSION_HASH = keccak256(toBytes('2'));

const DOMAIN_ABI = parseAbiParameters('bytes32, bytes32, bytes32, uint256, address, bytes32');
const STRUCT_ABI = parseAbiParameters('bytes32, bytes32, bytes32, bytes32, uint256, uint256');

/** Payload signed in a domain-separated EVM `.wraith` name authorization. */
export interface EvmNameAuthorizationPayload {
  /** Normalized `.wraith` name without trailing `.wraith`. */
  name: string;
  /** Raw 66-byte `0x`-prefixed meta-address bytes (`0x` / omitted for `name.release`). */
  metaAddressBytes?: HexString;
}

/**
 * Computes the deterministic EIP-712 domain separator for an EVM {@link SignatureDomain}.
 */
export function computeEvmDomainSeparator(domain: SignatureDomain): HexString {
  validateSignatureDomain(domain);
  if (domain.chain !== 'evm') {
    throw new TypeError(`Expected EVM domain, got "${domain.chain}"`);
  }
  const verifyingContract = getAddress(normalizeDomainContract('evm', domain.contract));
  const networkSalt = keccak256(toBytes(domain.network.trim()));

  return keccak256(
    encodeAbiParameters(DOMAIN_ABI, [
      EVM_DOMAIN_TYPEHASH,
      DOMAIN_NAME_HASH,
      DOMAIN_VERSION_HASH,
      domain.chainId!,
      verifyingContract,
      networkSalt,
    ]),
  ) as HexString;
}

/**
 * Computes the 32-byte EIP-712 digest (`\x19\x01 || domainSeparator || structHash`)
 * for an EVM `.wraith` name authorization.
 */
export function computeEvmNameAuthorizationDigest(
  domain: SignatureDomain,
  payload: EvmNameAuthorizationPayload,
): HexString {
  const domainSeparator = computeEvmDomainSeparator(domain);
  const cleanName = payload.name.replace(/\.wraith$/, '');
  const metaHex = (payload.metaAddressBytes ?? '0x') as HexString;

  const structHash = keccak256(
    encodeAbiParameters(STRUCT_ABI, [
      EVM_NAME_AUTH_TYPEHASH,
      keccak256(toBytes(domain.operation.trim())),
      keccak256(toBytes(cleanName)),
      keccak256(toBytes(metaHex)),
      domain.nonce,
      domain.expiry,
    ]),
  );

  return keccak256(
    encodePacked(['string', 'bytes32', 'bytes32'], ['\x19\x01', domainSeparator, structHash]),
  ) as HexString;
}

/**
 * Signs a domain-separated EIP-712 `.wraith` name authorization with the 32-byte spending key.
 */
export function signDomainNameAuthorization(
  domain: SignatureDomain,
  payload: EvmNameAuthorizationPayload,
  spendingKey: HexString,
): HexString {
  const digest = computeEvmNameAuthorizationDigest(domain, payload);
  return signRawSecp256k1Digest(digest, spendingKey);
}

/**
 * Verifies a domain-separated EVM `.wraith` name authorization against the expected
 * domain, expiration, nonce set, and expected 33-byte compressed public key or 20-byte address.
 */
export function verifyDomainNameAuthorization(
  signature: HexString,
  signedDomain: SignatureDomain,
  payload: EvmNameAuthorizationPayload,
  expectedPubKeyOrAddress: HexString,
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
    const vByte = sigBytes[64];
    const recovery = vByte >= 27 ? vByte - 27 : vByte;
    if (recovery !== 0 && recovery !== 1) {
      return { valid: false, reason: 'INVALID_SIGNATURE' };
    }

    const digest = computeEvmNameAuthorizationDigest(signedDomain, payload);
    const compact = sigBytes.slice(0, 64);
    const point = secp256k1.Signature.fromCompact(compact)
      .addRecoveryBit(recovery)
      .recoverPublicKey(toBytes(digest));

    const expectedClean = expectedPubKeyOrAddress.toLowerCase();
    let matches = false;
    if (expectedClean.length === 42) {
      const uncompressed = point.toRawBytes(false);
      const recoveredAddr = `0x${keccak256(toHex(uncompressed.slice(1))).slice(-40)}`.toLowerCase();
      matches = recoveredAddr === expectedClean;
    } else {
      const compressedHex = toHex(point.toRawBytes(true)).toLowerCase();
      matches = compressedHex === expectedClean;
    }

    if (!matches) {
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

/**
 * Signs a legacy v1 name registration message with the spending private key.
 *
 * @deprecated Use {@link signDomainNameAuthorization} with an explicit {@link SignatureDomain}
 * (`operation: 'name.register'`, `chainId`, `network`, `contract`, `nonce`, `expiry`).
 * Retained through 1.x for v1 contract compatibility and scheduled for removal in 2.0.0.
 */
export function signNameRegistration(
  name: string,
  metaAddressBytes: HexString,
  spendingKey: HexString,
): HexString {
  const digest = keccak256(encodePacked(['string', 'bytes'], [name, metaAddressBytes]));
  return signWithEthPrefix(digest, spendingKey);
}

/**
 * Signs a legacy v1 relayer-sponsored name registration message.
 *
 * @deprecated Use {@link signDomainNameAuthorization} with `operation: 'name.register_on_behalf'`
 * and an explicit {@link SignatureDomain}. Scheduled for removal in 2.0.0.
 */
export function signNameRegistrationOnBehalf(
  name: string,
  metaAddressBytes: HexString,
  spendingKey: HexString,
  nonce: bigint,
): HexString {
  const digest = keccak256(
    encodePacked(['string', 'bytes', 'uint256'], [name, metaAddressBytes, nonce]),
  );
  return signWithEthPrefix(digest, spendingKey);
}

/**
 * Signs a legacy v1 name update message with the spending private key.
 *
 * @deprecated Use {@link signDomainNameAuthorization} with `operation: 'name.update'`
 * and an explicit {@link SignatureDomain}. Scheduled for removal in 2.0.0.
 */
export function signNameUpdate(
  name: string,
  newMetaAddressBytes: HexString,
  spendingKey: HexString,
): HexString {
  const digest = keccak256(encodePacked(['string', 'bytes'], [name, newMetaAddressBytes]));
  return signWithEthPrefix(digest, spendingKey);
}

/**
 * Signs a legacy v1 name release message with the spending private key.
 *
 * @deprecated Use {@link signDomainNameAuthorization} with `operation: 'name.release'`
 * and an explicit {@link SignatureDomain}. Scheduled for removal in 2.0.0.
 */
export function signNameRelease(name: string, spendingKey: HexString): HexString {
  const digest = keccak256(encodePacked(['string'], [name]));
  return signWithEthPrefix(digest, spendingKey);
}

/**
 * Extracts the raw meta-address bytes from a full st:eth:0x... string.
 * Returns the 0x-prefixed 66-byte hex.
 */
export function metaAddressToBytes(metaAddress: string): HexString {
  if (!metaAddress.startsWith('st:eth:0x')) {
    throw new InvalidMetaAddressError(metaAddress, 'Invalid meta-address format');
  }
  return `0x${metaAddress.slice('st:eth:0x'.length)}` as HexString;
}

function signRawSecp256k1Digest(digest: HexString, privateKey: HexString): HexString {
  const sig = secp256k1.sign(toBytes(digest), toBytes(privateKey).slice(0, 32));
  const r = sig.r.toString(16).padStart(64, '0');
  const s = sig.s.toString(16).padStart(64, '0');
  const v = sig.recovery === 0 ? '1b' : '1c';
  return `0x${r}${s}${v}` as HexString;
}

function signWithEthPrefix(digest: HexString, privateKey: HexString): HexString {
  const prefixed = keccak256(
    encodePacked(['string', 'bytes32'], ['\x19Ethereum Signed Message:\n32', digest]),
  );
  return signRawSecp256k1Digest(prefixed as HexString, privateKey);
}
