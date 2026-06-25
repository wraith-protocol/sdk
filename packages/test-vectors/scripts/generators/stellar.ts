import { createHash } from 'crypto';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex } from '@noble/hashes/utils';
import {
  deriveStealthKeys,
  generateStealthAddress,
  deriveStealthPrivateScalar,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  signStellarTransaction,
} from '@wraith-protocol/sdk/chains/stellar';
import type {
  VectorSet,
  KeyDerivationVector,
  StealthGenerationVector,
  ScanMatchVector,
  SigningVector,
  EncodingVector,
} from '../../src/types';

function deterministicBytes(seed: string, index: number, length: number): Uint8Array {
  const input = `${seed}:stellar:${index}`;
  let hash = createHash('sha256').update(input).digest();
  const result = new Uint8Array(length);
  let offset = 0;

  while (offset < length) {
    const chunk = Math.min(length - offset, hash.length);
    result.set(hash.slice(0, chunk), offset);
    offset += chunk;
    if (offset < length) {
      hash = createHash('sha256').update(hash).digest();
    }
  }

  return result;
}

function generateSignature(seed: string, index: number): Uint8Array {
  return deterministicBytes(seed, index, 64);
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export function generateStellarVectors(seed: string, count: number): VectorSet {
  const keyDerivation: KeyDerivationVector[] = [];
  const stealthGeneration: StealthGenerationVector[] = [];
  const scanMatch: ScanMatchVector[] = [];
  const signing: SigningVector[] = [];
  const encoding: EncodingVector[] = [];

  for (let i = 0; i < count; i++) {
    // Key derivation vectors
    const signature = generateSignature(seed, i);
    const keys = deriveStealthKeys(signature);

    keyDerivation.push({
      signature: toBase64(signature),
      spendingKey: bytesToHex(keys.spendingKey),
      viewingKey: bytesToHex(keys.viewingKey),
      spendingPubKey: toBase64(keys.spendingPubKey),
      viewingPubKey: toBase64(keys.viewingPubKey),
      spendingScalar: '0x' + keys.spendingScalar.toString(16).padStart(64, '0'),
      viewingScalar: '0x' + keys.viewingScalar.toString(16).padStart(64, '0'),
    });

    // Encoding vectors
    const metaAddress = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
    encoding.push({
      spendingPubKey: toBase64(keys.spendingPubKey),
      viewingPubKey: toBase64(keys.viewingPubKey),
      metaAddress,
    });

    // Stealth generation vectors
    const ephemeralSeed = deterministicBytes(seed, i + 1000, 32);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, ephemeralSeed);

    stealthGeneration.push({
      spendingPubKey: toBase64(keys.spendingPubKey),
      viewingPubKey: toBase64(keys.viewingPubKey),
      ephemeralPrivateKey: bytesToHex(ephemeralSeed),
      ephemeralPubKey: toBase64(stealth.ephemeralPubKey),
      stealthAddress: stealth.stealthAddress,
      viewTag: stealth.viewTag,
    });

    // Scan match vectors (positive case)
    const stealthPrivateScalar = deriveStealthPrivateScalar(
      keys.spendingScalar,
      keys.viewingKey,
      stealth.ephemeralPubKey,
    );

    scanMatch.push({
      viewingKey: bytesToHex(keys.viewingKey),
      spendingPubKey: toBase64(keys.spendingPubKey),
      spendingKey: bytesToHex(keys.spendingKey),
      ephemeralPubKey: toBase64(stealth.ephemeralPubKey),
      stealthAddress: stealth.stealthAddress,
      viewTag: stealth.viewTag,
      shouldMatch: true,
      stealthPrivateScalar: '0x' + stealthPrivateScalar.toString(16).padStart(64, '0'),
    });

    // Scan match vectors (negative case - wrong viewing key)
    if (i > 0) {
      const wrongKeys = deriveStealthKeys(generateSignature(seed, i - 1));
      scanMatch.push({
        viewingKey: bytesToHex(wrongKeys.viewingKey),
        spendingPubKey: toBase64(wrongKeys.spendingPubKey),
        spendingKey: bytesToHex(wrongKeys.spendingKey),
        ephemeralPubKey: toBase64(stealth.ephemeralPubKey),
        stealthAddress: stealth.stealthAddress,
        viewTag: stealth.viewTag,
        shouldMatch: false,
      });
    }

    // Signing vectors
    const txHash = deterministicBytes(seed, i + 2000, 32);
    // Use the stealth private scalar for signing
    const stealthPubKey = ed25519.getPublicKey(keys.spendingKey);
    const signature_sign = signStellarTransaction(txHash, keys.spendingScalar, stealthPubKey);

    signing.push({
      privateKey: '0x' + keys.spendingScalar.toString(16).padStart(64, '0'),
      message: bytesToHex(txHash),
      signature: toBase64(signature_sign),
      publicKey: toBase64(keys.spendingPubKey),
    });
  }

  return {
    version: '1.0.0',
    chain: 'stellar',
    description: 'Stellar stealth address test vectors (ed25519, X25519 ECDH)',
    keyDerivation,
    stealthGeneration,
    scanMatch,
    signing,
    encoding,
  };
}
