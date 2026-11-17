import { InvalidSignatureError } from '../errors';

/** Protocol magic prefix for canonical Wraith domain-separated off-chain payloads. */
export const DOMAIN_AUTH_MAGIC = 'WRAITH-DOMAIN-SIG-V1';

/** Supported chain families for domain-separated wallet and relayer authorizations. */
export type AuthorizationChain = 'evm' | 'stellar' | 'solana' | 'ckb';

/** Canonical operation tags preventing cross-endpoint signature substitution. */
export type AuthorizationOperation =
  | 'name.register'
  | 'name.register_on_behalf'
  | 'name.update'
  | 'name.release'
  | 'stealth.key_derivation'
  | (string & {});

/**
 * Explicit authorization domain binding every off-chain wallet or spending-key
 * signature to a single chain, network, target contract/program, operation,
 * monotonic nonce, and expiration timestamp.
 */
export interface SignatureDomain {
  /** Chain family (`'evm'`, `'stellar'`, `'solana'`, `'ckb'`). */
  chain: AuthorizationChain;
  /** Canonical network identifier (e.g. `'eip155:2651420'`, Stellar passphrase, `'solana:devnet'`, `'ckb:testnet'`). */
  network: string;
  /** Target EVM contract address, Soroban contract ID, Solana program ID, or CKB script code hash. */
  contract: string;
  /** Operation identifier (e.g. `'name.register'`, `'name.update'`, `'name.release'`). */
  operation: AuthorizationOperation;
  /** Monotonic anti-replay nonce (`>= 0n`). */
  nonce: bigint;
  /** Unix expiration timestamp in seconds (`> 0n`); rejected when `nowSeconds >= expiry`. */
  expiry: bigint;
  /** Required EIP-155 numeric chain ID when `chain === 'evm'`. */
  chainId?: bigint;
}

/** Deterministic failure code returned when a signature or domain check fails. */
export type ReplayRejectionReason =
  | 'CHAIN_MISMATCH'
  | 'CHAIN_ID_MISMATCH'
  | 'NETWORK_MISMATCH'
  | 'CONTRACT_MISMATCH'
  | 'OPERATION_MISMATCH'
  | 'EXPIRED'
  | 'NONCE_REUSED'
  | 'INVALID_SIGNATURE';

/** Verifier context used to reject cross-domain, expired, or replayed signatures. */
export interface VerifyDomainOptions {
  /** Expected verifier domain (chain, network, contract, operation, chainId). */
  expectedDomain: Omit<SignatureDomain, 'nonce' | 'expiry'>;
  /** Current Unix timestamp in seconds (`signedDomain.expiry > nowSeconds` required). */
  nowSeconds: bigint;
  /** Optional nonce set scoped to `(signer, contract)`; checked before and updated after verification. */
  usedNonces?: Set<bigint>;
  /** Record `signedDomain.nonce` into `usedNonces` when verification succeeds (default: `true`). */
  recordNonce?: boolean;
}

/** Structured result of verifying a domain-separated authorization signature. */
export interface SignatureVerificationResult {
  valid: boolean;
  reason?: ReplayRejectionReason;
}

const UTF8 = new TextEncoder();

/** Normalizes contract/program identifiers (`0x` hex lowercased; base58/StrKey exact). */
export function normalizeDomainContract(chain: AuthorizationChain, contract: string): string {
  const trimmed = contract.trim();
  if (chain === 'evm' || chain === 'ckb' || trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

/** Validates required fields and numeric invariants on a {@link SignatureDomain}. */
export function validateSignatureDomain(domain: SignatureDomain): void {
  if (!domain.chain || !['evm', 'stellar', 'solana', 'ckb'].includes(domain.chain)) {
    throw new InvalidSignatureError(String(domain.chain));
  }
  if (!domain.network || !domain.network.trim()) {
    throw new InvalidSignatureError('domain.network must be non-empty');
  }
  if (!domain.contract || !domain.contract.trim()) {
    throw new InvalidSignatureError('domain.contract must be non-empty');
  }
  if (!domain.operation || !domain.operation.trim()) {
    throw new InvalidSignatureError('domain.operation must be non-empty');
  }
  if (typeof domain.nonce !== 'bigint' || domain.nonce < 0n) {
    throw new InvalidSignatureError('domain.nonce must be a non-negative bigint');
  }
  if (typeof domain.expiry !== 'bigint' || domain.expiry <= 0n) {
    throw new InvalidSignatureError('domain.expiry must be a positive bigint');
  }
  if (domain.chain === 'evm') {
    if (typeof domain.chainId !== 'bigint' || domain.chainId <= 0n) {
      throw new InvalidSignatureError('domain.chainId is required as a positive bigint on EVM');
    }
  }
}

function u32be(len: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, len >>> 0, false);
  return out;
}

function u64be(val: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, val, false);
  return out;
}

function u256be(val: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let rem = val;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(rem & 0xffn);
    rem >>= 8n;
  }
  return out;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Encodes a list of byte fields with unambiguous 4-byte big-endian length prefixes. */
export function encodeLengthPrefixedFields(fields: Uint8Array[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const field of fields) {
    chunks.push(u32be(field.length), field);
  }
  return concatChunks(chunks);
}

/**
 * Deterministically encodes `(domain, payloadBytes)` into canonical length-prefixed
 * bytes so distinct variable-length strings can never collide.
 */
export function encodeDomainAuthorizationBytes(
  domain: SignatureDomain,
  payloadBytes: Uint8Array,
): Uint8Array {
  validateSignatureDomain(domain);
  const magic = UTF8.encode(`${DOMAIN_AUTH_MAGIC}\0`);
  const chainBytes = UTF8.encode(domain.chain);
  const networkBytes = UTF8.encode(domain.network.trim());
  const contractBytes = UTF8.encode(normalizeDomainContract(domain.chain, domain.contract));
  const opBytes = UTF8.encode(domain.operation.trim());
  const chainIdBytes = u64be(domain.chain === 'evm' ? domain.chainId! : 0n);

  return concatChunks([
    magic,
    u32be(chainBytes.length),
    chainBytes,
    chainIdBytes,
    u32be(networkBytes.length),
    networkBytes,
    u32be(contractBytes.length),
    contractBytes,
    u32be(opBytes.length),
    opBytes,
    u256be(domain.nonce),
    u64be(domain.expiry),
    u32be(payloadBytes.length),
    payloadBytes,
  ]);
}

/**
 * Formats a deterministic, human-auditable wallet key-derivation / authorization
 * prompt containing explicit chain, network, contract, operation, nonce, and expiry.
 */
export function buildDomainStealthSigningMessage(
  domain: SignatureDomain,
  account?: string,
): string {
  validateSignatureDomain(domain);
  const lines = [
    'Wraith Protocol Domain-Separated Authorization (v2)',
    `Chain: ${domain.chain}`,
    ...(domain.chain === 'evm' ? [`Chain ID: ${domain.chainId!.toString()}`] : []),
    `Network: ${domain.network.trim()}`,
    `Contract: ${normalizeDomainContract(domain.chain, domain.contract)}`,
    `Operation: ${domain.operation.trim()}`,
    ...(account ? [`Account: ${account.trim()}`] : []),
    `Nonce: ${domain.nonce.toString()}`,
    `Expiry: ${domain.expiry.toString()}`,
  ];
  return lines.join('\n');
}

/**
 * Evaluates cross-chain, cross-network, cross-contract, operation, expiry, and
 * nonce-reuse guards before cryptographic signature acceptance.
 */
export function checkDomainGuards(
  signedDomain: SignatureDomain,
  options: VerifyDomainOptions,
): SignatureVerificationResult {
  validateSignatureDomain(signedDomain);
  const { expectedDomain, nowSeconds, usedNonces } = options;

  if (signedDomain.chain !== expectedDomain.chain) {
    return { valid: false, reason: 'CHAIN_MISMATCH' };
  }
  if (expectedDomain.chain === 'evm' && signedDomain.chainId !== expectedDomain.chainId) {
    return { valid: false, reason: 'CHAIN_ID_MISMATCH' };
  }
  if (signedDomain.network.trim() !== expectedDomain.network.trim()) {
    return { valid: false, reason: 'NETWORK_MISMATCH' };
  }
  if (
    normalizeDomainContract(signedDomain.chain, signedDomain.contract) !==
    normalizeDomainContract(expectedDomain.chain, expectedDomain.contract)
  ) {
    return { valid: false, reason: 'CONTRACT_MISMATCH' };
  }
  if (signedDomain.operation.trim() !== expectedDomain.operation.trim()) {
    return { valid: false, reason: 'OPERATION_MISMATCH' };
  }
  if (nowSeconds >= signedDomain.expiry) {
    return { valid: false, reason: 'EXPIRED' };
  }
  if (usedNonces?.has(signedDomain.nonce)) {
    return { valid: false, reason: 'NONCE_REUSED' };
  }
  return { valid: true };
}
