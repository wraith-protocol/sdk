import { createHash } from 'crypto';
import { secp256k1 } from '@noble/curves/secp256k1';
import { toHex, toBytes } from 'viem';
import {
  deriveStealthKeys,
  generateStealthAddress,
  deriveStealthPrivateKey,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
} from '@wraith-protocol/sdk/chains/ckb';
import type {
  VectorSet,
  KeyDerivationVector,
  StealthGenerationVector,
  ScanMatchVector,
  SigningVector,
  EncodingVector,
} from '../../src/types';

function deterministicBytes(seed: string, index: number, length: number): Uint8Array {
  const input = `${seed}:ckb:${index}`;
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

function generateSignature(seed: string, index: number): string {
  const bytes = deterministicBytes(seed, index, 65);
  // Ensure valid ECDSA signature format (v = 27 or 28)
  bytes[64] = 27 + (bytes[64] % 2);
  return toHex(bytes);
}

export function generateCKBVectors(seed: string, count: number): VectorSet {
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
      signature,
      spendingKey: keys.spendingKey,
      viewingKey: keys.viewingKey,
      spendingPubKey: keys.spendingPubKey,
      viewingPubKey: keys.viewingPubKey,
    });

    // Encoding vectors
    const metaAddress = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
    encoding.push({
      spendingPubKey: keys.spendingPubKey,
      viewingPubKey: keys.viewingPubKey,
      metaAddress,
    });

    // Stealth generation vectors
    const ephemeralPrivateKey = toHex(deterministicBytes(seed, i + 1000, 32));
    const stealth = generateStealthAddress(
      keys.spendingPubKey,
      keys.viewingPubKey,
      ephemeralPrivateKey,
    );

    stealthGeneration.push({
      spendingPubKey: keys.spendingPubKey,
      viewingPubKey: keys.viewingPubKey,
      ephemeralPrivateKey,
      ephemeralPubKey: stealth.ephemeralPubKey,
      stealthAddress: stealth.stealthPubKeyHash,
      viewTag: stealth.viewTag,
    });

    // Scan match vectors (positive case)
    const stealthPrivateKey = deriveStealthPrivateKey(
      keys.spendingKey,
      stealth.ephemeralPubKey,
      keys.viewingKey,
    );

    scanMatch.push({
      viewingKey: keys.viewingKey,
      spendingPubKey: keys.spendingPubKey,
      spendingKey: keys.spendingKey,
      ephemeralPubKey: stealth.ephemeralPubKey,
      stealthAddress: stealth.stealthPubKeyHash,
      viewTag: stealth.viewTag,
      shouldMatch: true,
      stealthPrivateKey,
    });

    // Scan match vectors (negative case - wrong viewing key)
    if (i > 0) {
      const wrongKeys = deriveStealthKeys(generateSignature(seed, i - 1));
      scanMatch.push({
        viewingKey: wrongKeys.viewingKey,
        spendingPubKey: wrongKeys.spendingPubKey,
        spendingKey: wrongKeys.spendingKey,
        ephemeralPubKey: stealth.ephemeralPubKey,
        stealthAddress: stealth.stealthPubKeyHash,
        viewTag: stealth.viewTag,
        shouldMatch: false,
      });
    }

    // Signing vectors (CKB uses secp256k1 like EVM)
    const message = toHex(deterministicBytes(seed, i + 2000, 32));
    const messageHash = createHash('sha256').update(toBytes(message)).digest();
    const signature_sign = secp256k1.sign(messageHash, toBytes(keys.spendingKey));

    signing.push({
      privateKey: keys.spendingKey,
      message,
      signature: toHex(signature_sign.toCompactRawBytes()),
      publicKey: keys.spendingPubKey,
    });
  }

  return {
    version: '1.0.0',
    chain: 'ckb',
    description: 'CKB (Nervos) stealth address test vectors (secp256k1, blake2b)',
    keyDerivation,
    stealthGeneration,
    scanMatch,
    signing,
    encoding,
  };
}
