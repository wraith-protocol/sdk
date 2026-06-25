/**
 * @wraith-protocol/test-vectors
 *
 * Deterministic test vectors for cross-language verification of Wraith
 * stealth address cryptography across EVM, Stellar, Solana, and CKB chains.
 */

export type {
  KeyDerivationVector,
  StealthGenerationVector,
  ScanMatchVector,
  SigningVector,
  EncodingVector,
  VectorSet,
  Checksum,
} from './types';

// Re-export vector JSON files for programmatic access
export { default as evmVectors } from '../vectors/evm.json';
export { default as stellarVectors } from '../vectors/stellar.json';
export { default as solanaVectors } from '../vectors/solana.json';
export { default as ckbVectors } from '../vectors/ckb.json';
export { default as checksum } from '../checksum.json';
