import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Networks } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  DOMAIN_AUTH_MAGIC,
  InvalidSignatureError,
  buildDomainStealthSigningMessage,
  encodeDomainAuthorizationBytes,
  encodeLengthPrefixedFields,
  validateSignatureDomain,
  type SignatureDomain,
} from '../../src';
import * as ckb from '../../src/chains/ckb';
import * as evm from '../../src/chains/evm';
import * as solana from '../../src/chains/solana';
import * as stellar from '../../src/chains/stellar';

const testVectorsDir = resolve(__dirname, '..', '..', 'packages', 'test-vectors');
const UTF8 = new TextEncoder();

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function parseVectorDomain(raw: Record<string, string>): SignatureDomain {
  return {
    chain: raw.chain as SignatureDomain['chain'],
    ...(raw.chainId !== undefined ? { chainId: BigInt(raw.chainId) } : {}),
    network: raw.network,
    contract: raw.contract,
    operation: raw.operation,
    nonce: BigInt(raw.nonce),
    expiry: BigInt(raw.expiry),
  };
}

describe('Domain-Separated Wallet Signatures & Cross-Chain Replay Suite', () => {
  const checksums = JSON.parse(readFileSync(join(testVectorsDir, 'checksum.json'), 'utf8'));
  const fixture = JSON.parse(
    readFileSync(join(testVectorsDir, 'vectors', 'wallet-signatures.json'), 'utf8'),
  );

  it('verifies SHA-256 checksums and schema of published wallet-signatures.json vectors', () => {
    expect(fixture.schemaVersion).toBe('1.0.0');
    expect(fixture.magic).toBe(DOMAIN_AUTH_MAGIC);
    expect(checksums.files['vectors/wallet-signatures.json']).toMatch(/^[0-9a-f]{64}$/);

    for (const [relPath, expected] of Object.entries(checksums.files)) {
      const normalized = readFileSync(join(testVectorsDir, relPath), 'utf8').replace(/\r\n/g, '\n');
      const actual = createHash('sha256').update(Buffer.from(normalized, 'utf8')).digest('hex');
      expect(actual, `checksum drift in ${relPath}`).toBe(expected);
    }
  });

  it('reproduces every published valid vector deterministically and preserves legacy v1 compatibility', () => {
    const evmKeys = evm.deriveStealthKeys(`0x${'11'.repeat(32)}${'22'.repeat(32)}1b`);
    const stellarKeys = stellar.deriveStealthKeys(new Uint8Array(64).fill(0x33));
    const solanaKeys = solana.deriveStealthKeys(new Uint8Array(64).fill(0x44));
    const ckbKeys = ckb.deriveStealthKeys(`0x${'55'.repeat(32)}${'66'.repeat(32)}1b`);

    // EVM valid vectors
    for (const vec of fixture.validVectors.evm) {
      const domain = parseVectorDomain(vec.domain);
      expect(evm.computeEvmDomainSeparator(domain)).toBe(vec.domainSeparator);
      expect(evm.computeEvmNameAuthorizationDigest(domain, vec.payload)).toBe(vec.digest);
      expect(evm.signDomainNameAuthorization(domain, vec.payload, evmKeys.spendingKey)).toBe(
        vec.signature,
      );

      const usedNonces = new Set<bigint>();
      const verified = evm.verifyDomainNameAuthorization(
        vec.signature,
        domain,
        vec.payload,
        vec.signerPubKey,
        {
          expectedDomain: {
            chain: domain.chain,
            chainId: domain.chainId,
            network: domain.network,
            contract: domain.contract,
            operation: domain.operation,
          },
          nowSeconds: 1_800_000_000n,
          usedNonces,
        },
      );
      expect(verified).toEqual({ valid: true });
      expect(usedNonces.has(domain.nonce)).toBe(true);
    }

    // Distinct digests for register vs update on identical (name, metaAddressBytes)!
    expect(fixture.validVectors.evm[0].digest).not.toBe(fixture.validVectors.evm[1].digest);
    expect(fixture.validVectors.evm[0].signature).not.toBe(fixture.validVectors.evm[1].signature);

    // Stellar valid vector
    for (const vec of fixture.validVectors.stellar) {
      const domain = parseVectorDomain(vec.domain);
      const payload = hexToBytes(vec.payloadHex);
      expect(bytesToHex(encodeDomainAuthorizationBytes(domain, payload))).toBe(vec.encodedBytesHex);
      expect(bytesToHex(stellar.computeStellarAuthorizationDigest(domain, payload))).toBe(
        vec.digestHex,
      );
      const sig = stellar.signStellarDomainAuthorization(domain, payload, stellarKeys.spendingKey);
      expect(bytesToHex(sig)).toBe(vec.signatureHex);
      expect(
        stellar.verifyStellarDomainAuthorization(sig, domain, payload, stellarKeys.spendingPubKey, {
          expectedDomain: domain,
          nowSeconds: 1_800_000_000n,
        }),
      ).toEqual({ valid: true });
    }

    // Solana valid vector
    for (const vec of fixture.validVectors.solana) {
      const domain = parseVectorDomain(vec.domain);
      const payload = hexToBytes(vec.payloadHex);
      const sig = solana.signSolanaDomainAuthorization(domain, payload, solanaKeys.spendingKey);
      expect(bytesToHex(sig)).toBe(vec.signatureHex);
      expect(
        solana.verifySolanaDomainAuthorization(sig, domain, payload, solanaKeys.spendingPubKey, {
          expectedDomain: domain,
          nowSeconds: 1_800_000_000n,
        }),
      ).toEqual({ valid: true });
    }

    // CKB valid vector
    for (const vec of fixture.validVectors.ckb) {
      const domain = parseVectorDomain(vec.domain);
      const payload = hexToBytes(vec.payloadHex);
      expect(ckb.computeCkbAuthorizationDigest(domain, payload)).toBe(vec.digest);
      const sig = ckb.signCkbDomainAuthorization(domain, payload, ckbKeys.spendingKey);
      expect(sig).toBe(vec.signature);
      expect(
        ckb.verifyCkbDomainAuthorization(sig, domain, payload, ckbKeys.spendingPubKey, {
          expectedDomain: domain,
          nowSeconds: 1_800_000_000n,
        }),
      ).toEqual({ valid: true });
    }

    // Wallet key-derivation prompt determinism
    const promptVec = fixture.validVectors.walletKeyDerivationPrompt;
    expect(
      buildDomainStealthSigningMessage(parseVectorDomain(promptVec.domain), promptVec.account),
    ).toBe(promptVec.message);

    // Legacy v1 compatibility vectors remain byte-identical
    const v1 = fixture.validVectors.legacyV1Compatibility;
    expect(evm.signNameRegistration(v1.name, v1.metaAddressBytes, evmKeys.spendingKey)).toBe(
      v1.registerSignature,
    );
    expect(
      evm.signNameRegistrationOnBehalf(v1.name, v1.metaAddressBytes, evmKeys.spendingKey, 1n),
    ).toBe(v1.registerOnBehalfNonce1Signature);
    expect(evm.signNameRelease(v1.name, evmKeys.spendingKey)).toBe(v1.releaseSignature);
  });

  it('rejects all published replay vectors and forged-domain claim substitutions', () => {
    const evmRegisterVec = fixture.validVectors.evm[0];
    const stellarRegisterVec = fixture.validVectors.stellar[0];

    for (const replay of fixture.replayVectors) {
      const targetDomain = parseVectorDomain(replay.targetDomain);
      const nowSeconds = BigInt(replay.nowSeconds);
      const usedNonces = new Set<bigint>(
        (replay.preUsedNonces ?? []).map((n: string) => BigInt(n)),
      );

      if (replay.sourceVectorId === 'evm_domain_name_register') {
        const signedDomain = parseVectorDomain(evmRegisterVec.domain);

        // 1. Honest signedDomain envelope rejected by explicit domain/expiry/nonce guard
        const honestCheck = evm.verifyDomainNameAuthorization(
          evmRegisterVec.signature,
          signedDomain,
          evmRegisterVec.payload,
          evmRegisterVec.signerPubKey,
          { expectedDomain: targetDomain, nowSeconds, usedNonces },
        );
        expect(honestCheck).toEqual({ valid: false, reason: replay.expectedReason });

        // 2. Forged signedDomain envelope (attacker rewrites signedDomain to match target!)
        //    must fail cryptographic ECDSA public-key match when target != signedDomain.
        if (targetDomain.chain === 'evm') {
          const forgedDomain: SignatureDomain = {
            ...targetDomain,
            nonce: replay.expectedReason === 'NONCE_REUSED' ? 99n : signedDomain.nonce,
            expiry: replay.expectedReason === 'EXPIRED' ? nowSeconds + 3600n : signedDomain.expiry,
          };
          const forgedCheck = evm.verifyDomainNameAuthorization(
            evmRegisterVec.signature,
            forgedDomain,
            evmRegisterVec.payload,
            evmRegisterVec.signerPubKey,
            { expectedDomain: forgedDomain, nowSeconds, usedNonces },
          );
          expect(forgedCheck).toEqual({ valid: false, reason: 'INVALID_SIGNATURE' });
        } else if (targetDomain.chain === 'ckb') {
          // Same secp256k1 curve & private key replayed onto CKB with forged CKB domain!
          const forgedCkbCheck = ckb.verifyCkbDomainAuthorization(
            evmRegisterVec.signature,
            targetDomain,
            encodeLengthPrefixedFields([
              UTF8.encode(evmRegisterVec.payload.name),
              UTF8.encode(evmRegisterVec.payload.metaAddressBytes),
            ]),
            evmRegisterVec.signerPubKey,
            { expectedDomain: targetDomain, nowSeconds },
          );
          expect(forgedCkbCheck).toEqual({ valid: false, reason: 'INVALID_SIGNATURE' });
        }
      } else if (replay.sourceVectorId === 'stellar_domain_name_register') {
        const signedDomain = parseVectorDomain(stellarRegisterVec.domain);
        const sigBytes = hexToBytes(stellarRegisterVec.signatureHex);
        const pubBytes = hexToBytes(stellarRegisterVec.signerPubKeyHex);
        const payload = hexToBytes(stellarRegisterVec.payloadHex);

        // 1. Honest signedDomain envelope rejected by guard
        const honestCheck = stellar.verifyStellarDomainAuthorization(
          sigBytes,
          signedDomain,
          payload,
          pubBytes,
          { expectedDomain: targetDomain, nowSeconds, usedNonces },
        );
        expect(honestCheck).toEqual({ valid: false, reason: replay.expectedReason });

        // 2. Same ed25519 key & signature replayed onto Solana or Stellar Public with forged domain!
        if (targetDomain.chain === 'solana') {
          const forgedSolCheck = solana.verifySolanaDomainAuthorization(
            sigBytes,
            targetDomain,
            payload,
            pubBytes,
            { expectedDomain: targetDomain, nowSeconds },
          );
          expect(forgedSolCheck).toEqual({ valid: false, reason: 'INVALID_SIGNATURE' });
        } else {
          const forgedStellarCheck = stellar.verifyStellarDomainAuthorization(
            sigBytes,
            targetDomain,
            payload,
            pubBytes,
            { expectedDomain: targetDomain, nowSeconds },
          );
          expect(forgedStellarCheck).toEqual({ valid: false, reason: 'INVALID_SIGNATURE' });
        }
      }
    }
  });

  it('prevents length-concatenation collisions across variable-length domain and payload fields', () => {
    const domainA: SignatureDomain = {
      chain: 'stellar',
      network: `${Networks.TESTNET}:a`,
      contract: 'bc',
      operation: 'name.register',
      nonce: 1n,
      expiry: 1_900_000_000n,
    };
    const domainB: SignatureDomain = {
      chain: 'stellar',
      network: Networks.TESTNET,
      contract: ':abc',
      operation: 'name.register',
      nonce: 1n,
      expiry: 1_900_000_000n,
    };

    const payloadA = encodeLengthPrefixedFields([UTF8.encode('ab'), UTF8.encode('cd')]);
    const payloadB = encodeLengthPrefixedFields([UTF8.encode('a'), UTF8.encode('bcd')]);

    expect(bytesToHex(payloadA)).not.toBe(bytesToHex(payloadB));
    expect(bytesToHex(encodeDomainAuthorizationBytes(domainA, payloadA))).not.toBe(
      bytesToHex(encodeDomainAuthorizationBytes(domainB, payloadA)),
    );
  });

  it('rejects oversized u256 nonce and u64 expiry/chainId values before encoding and prevents truncation collisions', () => {
    const MAX_U64 = (1n << 64n) - 1n;
    const MAX_U256 = (1n << 256n) - 1n;
    const OVERFLOW_U64 = 1n << 64n;
    const OVERFLOW_U256 = 1n << 256n;

    const payload = encodeLengthPrefixedFields([UTF8.encode('alice')]);
    const evmPayload = { name: 'alice' };

    const baseStellarDomain: SignatureDomain = {
      chain: 'stellar',
      network: Networks.TESTNET,
      contract: stellar.getDeployment('stellar').contracts.names,
      operation: 'name.register',
      nonce: 0n,
      expiry: 1_900_000_000n,
    };

    const baseEvmDomain: SignatureDomain = {
      chain: 'evm',
      chainId: 1n,
      network: 'eip155:1',
      contract: evm.getDeployment('horizen').contracts.names,
      operation: 'name.register',
      nonce: 0n,
      expiry: 1_900_000_000n,
    };

    // Boundary maximums (2^256 - 1 for nonce, 2^64 - 1 for expiry and EVM chainId) encode cleanly
    // and produce distinct canonical bytes from low values (0n / 1n).
    const maxStellarDomain: SignatureDomain = {
      ...baseStellarDomain,
      nonce: MAX_U256,
      expiry: MAX_U64,
    };
    const maxEvmDomain: SignatureDomain = {
      ...baseEvmDomain,
      chainId: MAX_U64,
      nonce: MAX_U256,
      expiry: MAX_U64,
    };

    const minStellarEncoded = encodeDomainAuthorizationBytes(baseStellarDomain, payload);
    const maxStellarEncoded = encodeDomainAuthorizationBytes(maxStellarDomain, payload);
    expect(bytesToHex(maxStellarEncoded)).not.toBe(bytesToHex(minStellarEncoded));
    expect(bytesToHex(maxStellarEncoded)).toContain(`${'ff'.repeat(32)}${'ff'.repeat(8)}`);

    const minEvmEncoded = encodeDomainAuthorizationBytes(baseEvmDomain, payload);
    const maxEvmEncoded = encodeDomainAuthorizationBytes(maxEvmDomain, payload);
    expect(bytesToHex(maxEvmEncoded)).not.toBe(bytesToHex(minEvmEncoded));
    expect(evm.computeEvmDomainSeparator(maxEvmDomain)).not.toBe(
      evm.computeEvmDomainSeparator(baseEvmDomain),
    );
    expect(evm.computeEvmNameAuthorizationDigest(maxEvmDomain, evmPayload)).not.toBe(
      evm.computeEvmNameAuthorizationDigest(baseEvmDomain, evmPayload),
    );

    // Oversized nonce values (> 2^256 - 1) must be rejected before encoding so nonce 2^256 cannot
    // collide with nonce 0 (or 2^256 + 1 with 1).
    for (const badNonce of [-1n, OVERFLOW_U256, OVERFLOW_U256 + 1n]) {
      const badStellar = { ...baseStellarDomain, nonce: badNonce };
      const badEvm = { ...baseEvmDomain, nonce: badNonce };
      expect(() => validateSignatureDomain(badStellar)).toThrow(InvalidSignatureError);
      expect(() => encodeDomainAuthorizationBytes(badStellar, payload)).toThrow(
        InvalidSignatureError,
      );
      expect(() => buildDomainStealthSigningMessage(badStellar)).toThrow(InvalidSignatureError);
      expect(() => stellar.computeStellarAuthorizationDigest(badStellar, payload)).toThrow(
        InvalidSignatureError,
      );
      expect(() =>
        solana.computeSolanaAuthorizationDigest(
          { ...badStellar, chain: 'solana', network: 'solana:devnet' },
          payload,
        ),
      ).toThrow(InvalidSignatureError);
      expect(() =>
        ckb.computeCkbAuthorizationDigest(
          {
            ...badStellar,
            chain: 'ckb',
            network: 'ckb:testnet',
            contract: ckb.getDeployment('ckb').contracts.namesTypeCodeHash,
          },
          payload,
        ),
      ).toThrow(InvalidSignatureError);
      expect(() => encodeDomainAuthorizationBytes(badEvm, payload)).toThrow(InvalidSignatureError);
      expect(() => evm.computeEvmNameAuthorizationDigest(badEvm, evmPayload)).toThrow(
        InvalidSignatureError,
      );
    }

    // Oversized expiry values (> 2^64 - 1) and non-positive values must be rejected before encoding.
    for (const badExpiry of [-1n, 0n, OVERFLOW_U64, OVERFLOW_U64 + 1_900_000_000n]) {
      const badStellar = { ...baseStellarDomain, expiry: badExpiry };
      const badEvm = { ...baseEvmDomain, expiry: badExpiry };
      expect(() => validateSignatureDomain(badStellar)).toThrow(InvalidSignatureError);
      expect(() => encodeDomainAuthorizationBytes(badStellar, payload)).toThrow(
        InvalidSignatureError,
      );
      expect(() => buildDomainStealthSigningMessage(badStellar)).toThrow(InvalidSignatureError);
      expect(() => stellar.computeStellarAuthorizationDigest(badStellar, payload)).toThrow(
        InvalidSignatureError,
      );
      expect(() => encodeDomainAuthorizationBytes(badEvm, payload)).toThrow(InvalidSignatureError);
      expect(() => evm.computeEvmNameAuthorizationDigest(badEvm, evmPayload)).toThrow(
        InvalidSignatureError,
      );
    }

    // Oversized generic EVM chain ID values (> 2^64 - 1) and non-positive values must be rejected
    // before encoding so chainId 1 + 2^64 cannot collide with chainId 1 in u64be.
    for (const badChainId of [-1n, 0n, OVERFLOW_U64, OVERFLOW_U64 + 1n]) {
      const badEvm = { ...baseEvmDomain, chainId: badChainId };
      expect(() => validateSignatureDomain(badEvm)).toThrow(InvalidSignatureError);
      expect(() => encodeDomainAuthorizationBytes(badEvm, payload)).toThrow(InvalidSignatureError);
      expect(() => buildDomainStealthSigningMessage(badEvm)).toThrow(InvalidSignatureError);
      expect(() => evm.computeEvmDomainSeparator(badEvm)).toThrow(InvalidSignatureError);
      expect(() => evm.computeEvmNameAuthorizationDigest(badEvm, evmPayload)).toThrow(
        InvalidSignatureError,
      );
    }

    // End-to-end replay/expiry/chainId truncation-bypass regressions against verifiers.
    const stellarKeys = stellar.deriveStealthKeys(new Uint8Array(64).fill(0x33));
    const solanaKeys = solana.deriveStealthKeys(new Uint8Array(64).fill(0x44));
    const ckbKeys = ckb.deriveStealthKeys(`0x${'55'.repeat(32)}${'66'.repeat(32)}1b`);
    const evmKeys = evm.deriveStealthKeys(`0x${'11'.repeat(32)}${'22'.repeat(32)}1b`);

    // 1. Nonce 0 -> 2^256 wraparound replay must fail verification and never bypass usedNonces.
    const stellarNonce0Sig = stellar.signStellarDomainAuthorization(
      baseStellarDomain,
      payload,
      stellarKeys.spendingKey,
    );
    const usedNonces = new Set<bigint>();
    expect(
      stellar.verifyStellarDomainAuthorization(
        stellarNonce0Sig,
        baseStellarDomain,
        payload,
        stellarKeys.spendingPubKey,
        { expectedDomain: baseStellarDomain, nowSeconds: 1_800_000_000n, usedNonces },
      ),
    ).toEqual({ valid: true });
    expect(usedNonces.has(0n)).toBe(true);

    expect(
      stellar.verifyStellarDomainAuthorization(
        stellarNonce0Sig,
        { ...baseStellarDomain, nonce: OVERFLOW_U256 },
        payload,
        stellarKeys.spendingPubKey,
        { expectedDomain: baseStellarDomain, nowSeconds: 1_800_000_000n, usedNonces },
      ),
    ).toEqual({ valid: false, reason: 'INVALID_SIGNATURE' });
    expect(usedNonces.has(OVERFLOW_U256)).toBe(false);

    const solanaDomain: SignatureDomain = {
      chain: 'solana',
      network: 'solana:devnet',
      contract: solana.getDeployment('solana').contracts.names,
      operation: 'name.register',
      nonce: 0n,
      expiry: 1_900_000_000n,
    };
    const solanaNonce0Sig = solana.signSolanaDomainAuthorization(
      solanaDomain,
      payload,
      solanaKeys.spendingKey,
    );
    expect(
      solana.verifySolanaDomainAuthorization(
        solanaNonce0Sig,
        { ...solanaDomain, nonce: OVERFLOW_U256 },
        payload,
        solanaKeys.spendingPubKey,
        { expectedDomain: solanaDomain, nowSeconds: 1_800_000_000n, usedNonces: new Set([0n]) },
      ),
    ).toEqual({ valid: false, reason: 'INVALID_SIGNATURE' });

    const ckbDomain: SignatureDomain = {
      chain: 'ckb',
      network: 'ckb:testnet',
      contract: ckb.getDeployment('ckb').contracts.namesTypeCodeHash,
      operation: 'name.register',
      nonce: 0n,
      expiry: 1_900_000_000n,
    };
    const ckbNonce0Sig = ckb.signCkbDomainAuthorization(ckbDomain, payload, ckbKeys.spendingKey);
    expect(
      ckb.verifyCkbDomainAuthorization(
        ckbNonce0Sig,
        { ...ckbDomain, nonce: OVERFLOW_U256 },
        payload,
        ckbKeys.spendingPubKey,
        { expectedDomain: ckbDomain, nowSeconds: 1_800_000_000n, usedNonces: new Set([0n]) },
      ),
    ).toEqual({ valid: false, reason: 'INVALID_SIGNATURE' });

    // 2. Expired signature (expiry = 1_700_000_000) presented with expiry + 2^64 must fail.
    const expiredStellarDomain: SignatureDomain = {
      ...baseStellarDomain,
      expiry: 1_700_000_000n,
    };
    const expiredStellarSig = stellar.signStellarDomainAuthorization(
      expiredStellarDomain,
      payload,
      stellarKeys.spendingKey,
    );
    expect(
      stellar.verifyStellarDomainAuthorization(
        expiredStellarSig,
        { ...expiredStellarDomain, expiry: 1_700_000_000n + OVERFLOW_U64 },
        payload,
        stellarKeys.spendingPubKey,
        { expectedDomain: expiredStellarDomain, nowSeconds: 1_800_000_000n },
      ),
    ).toEqual({ valid: false, reason: 'INVALID_SIGNATURE' });

    // 3. EVM verifier rejects oversized chainId, expiry, and nonce even when matching expectedDomain.
    const evmSig = evm.signDomainNameAuthorization(baseEvmDomain, evmPayload, evmKeys.spendingKey);
    expect(
      evm.verifyDomainNameAuthorization(
        evmSig,
        { ...baseEvmDomain, chainId: 1n + OVERFLOW_U64 },
        evmPayload,
        evmKeys.spendingPubKey,
        {
          expectedDomain: { ...baseEvmDomain, chainId: 1n + OVERFLOW_U64 },
          nowSeconds: 1_800_000_000n,
        },
      ),
    ).toEqual({ valid: false, reason: 'INVALID_SIGNATURE' });
    expect(
      evm.verifyDomainNameAuthorization(
        evmSig,
        { ...baseEvmDomain, nonce: OVERFLOW_U256 },
        evmPayload,
        evmKeys.spendingPubKey,
        { expectedDomain: baseEvmDomain, nowSeconds: 1_800_000_000n, usedNonces: new Set([0n]) },
      ),
    ).toEqual({ valid: false, reason: 'INVALID_SIGNATURE' });
    expect(
      evm.verifyDomainNameAuthorization(
        evmSig,
        { ...baseEvmDomain, expiry: 1_900_000_000n + OVERFLOW_U64 },
        evmPayload,
        evmKeys.spendingPubKey,
        { expectedDomain: baseEvmDomain, nowSeconds: 1_800_000_000n },
      ),
    ).toEqual({ valid: false, reason: 'INVALID_SIGNATURE' });
  });
});
