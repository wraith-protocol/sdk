/**
 * Test vector types for cross-language verification
 */

export interface KeyDerivationVector {
  /** Input signature (hex string for EVM/CKB, or base64 for Stellar/Solana) */
  signature: string;
  /** Expected spending private key (hex) */
  spendingKey: string;
  /** Expected viewing private key (hex) */
  viewingKey: string;
  /** Expected spending public key (hex or base64) */
  spendingPubKey: string;
  /** Expected viewing public key (hex or base64) */
  viewingPubKey: string;
  /** Additional scalar values for ed25519 chains */
  spendingScalar?: string;
  viewingScalar?: string;
}

export interface StealthGenerationVector {
  /** Recipient's spending public key */
  spendingPubKey: string;
  /** Recipient's viewing public key */
  viewingPubKey: string;
  /** Ephemeral private key/seed used (for determinism) */
  ephemeralPrivateKey: string;
  /** Expected ephemeral public key */
  ephemeralPubKey: string;
  /** Expected stealth address */
  stealthAddress: string;
  /** Expected view tag (0-255) */
  viewTag: number;
}

export interface ScanMatchVector {
  /** Recipient's viewing private key */
  viewingKey: string;
  /** Recipient's spending public key */
  spendingPubKey: string;
  /** Recipient's spending private key (for full match) */
  spendingKey: string;
  /** Ephemeral public key from announcement */
  ephemeralPubKey: string;
  /** Stealth address from announcement */
  stealthAddress: string;
  /** View tag from announcement */
  viewTag: number;
  /** Should this announcement match? */
  shouldMatch: boolean;
  /** Expected stealth private key (if shouldMatch) */
  stealthPrivateKey?: string;
  /** Expected stealth private scalar for ed25519 (if shouldMatch) */
  stealthPrivateScalar?: string;
}

export interface SigningVector {
  /** Private key or scalar used for signing */
  privateKey: string;
  /** Message to sign (hex-encoded transaction hash) */
  message: string;
  /** Expected signature (format depends on chain) */
  signature: string;
  /** Public key corresponding to private key */
  publicKey: string;
}

export interface EncodingVector {
  /** Spending public key */
  spendingPubKey: string;
  /** Viewing public key */
  viewingPubKey: string;
  /** Expected meta-address string (e.g., "st:eth:0x...") */
  metaAddress: string;
}

export interface VectorSet {
  version: string;
  chain: string;
  description: string;
  keyDerivation: KeyDerivationVector[];
  stealthGeneration: StealthGenerationVector[];
  scanMatch: ScanMatchVector[];
  signing: SigningVector[];
  encoding: EncodingVector[];
}

export interface Checksum {
  version: string;
  generated: string;
  files: Record<string, string>;
}
