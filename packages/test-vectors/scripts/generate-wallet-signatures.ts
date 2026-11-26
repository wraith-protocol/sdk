#!/usr/bin/env tsx
/**
 * Generates deterministic domain-separated wallet/authorization signature vectors
 * and negative cross-chain / cross-network / cross-contract / altered-operation /
 * expired / nonce-reuse replay fixtures in `vectors/wallet-signatures.json`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Networks } from '@stellar/stellar-sdk';
import {
  DOMAIN_AUTH_MAGIC,
  buildDomainStealthSigningMessage,
  encodeDomainAuthorizationBytes,
  encodeLengthPrefixedFields,
  type SignatureDomain,
} from '../../../src/auth/domain';
import * as ckb from '../../../src/chains/ckb';
import * as evm from '../../../src/chains/evm';
import * as solana from '../../../src/chains/solana';
import * as stellar from '../../../src/chains/stellar';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'vectors');
mkdirSync(OUT_DIR, { recursive: true });

const UTF8 = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function serializeDomain(domain: SignatureDomain) {
  return {
    chain: domain.chain,
    ...(domain.chainId !== undefined ? { chainId: domain.chainId.toString() } : {}),
    network: domain.network,
    contract: domain.contract,
    operation: domain.operation,
    nonce: domain.nonce.toString(),
    expiry: domain.expiry.toString(),
  };
}

function generateWalletSignatureVectors() {
  // Deterministic signer key material
  const evmWalletSig = `0x${'11'.repeat(32)}${'22'.repeat(32)}1b` as const;
  const evmKeys = evm.deriveStealthKeys(evmWalletSig);
  const evmMeta = evm.encodeStealthMetaAddress(evmKeys.spendingPubKey, evmKeys.viewingPubKey);
  const evmMetaBytes = evm.metaAddressToBytes(evmMeta);
  const evmNamesContract = evm.getDeployment('horizen').contracts.names;

  const stellarWalletSig = new Uint8Array(64).fill(0x33);
  const stellarKeys = stellar.deriveStealthKeys(stellarWalletSig);
  const stellarMeta = stellar.encodeStealthMetaAddress(
    stellarKeys.spendingPubKey,
    stellarKeys.viewingPubKey,
  );
  const stellarNamesContract = stellar.getDeployment('stellar').contracts.names;

  const solanaWalletSig = new Uint8Array(64).fill(0x44);
  const solanaKeys = solana.deriveStealthKeys(solanaWalletSig);
  const solanaMeta = solana.encodeStealthMetaAddress(
    solanaKeys.spendingPubKey,
    solanaKeys.viewingPubKey,
  );
  const solanaNamesProgram = solana.getDeployment('solana').contracts.names;

  const ckbWalletSig = `0x${'55'.repeat(32)}${'66'.repeat(32)}1b` as const;
  const ckbKeys = ckb.deriveStealthKeys(ckbWalletSig);
  const ckbMeta = ckb.encodeStealthMetaAddress(ckbKeys.spendingPubKey, ckbKeys.viewingPubKey);
  const ckbNamesCodeHash = ckb.getDeployment('ckb').contracts.namesTypeCodeHash;

  // Canonical domains
  const evmRegisterDomain: SignatureDomain = {
    chain: 'evm',
    chainId: 2651420n,
    network: 'eip155:2651420',
    contract: evmNamesContract,
    operation: 'name.register',
    nonce: 1n,
    expiry: 1_900_000_000n,
  };
  const evmUpdateDomain: SignatureDomain = {
    ...evmRegisterDomain,
    operation: 'name.update',
    nonce: 2n,
  };
  const evmReleaseDomain: SignatureDomain = {
    ...evmRegisterDomain,
    operation: 'name.release',
    nonce: 3n,
  };

  const evmRegisterPayload = { name: 'alice', metaAddressBytes: evmMetaBytes };
  const evmReleasePayload = { name: 'alice' };

  const evmRegisterSig = evm.signDomainNameAuthorization(
    evmRegisterDomain,
    evmRegisterPayload,
    evmKeys.spendingKey,
  );
  const evmUpdateSig = evm.signDomainNameAuthorization(
    evmUpdateDomain,
    evmRegisterPayload,
    evmKeys.spendingKey,
  );
  const evmReleaseSig = evm.signDomainNameAuthorization(
    evmReleaseDomain,
    evmReleasePayload,
    evmKeys.spendingKey,
  );

  // Legacy v1 compatibility vectors (retained in 1.x, deprecated for 2.0)
  const legacyV1RegisterSig = evm.signNameRegistration('alice', evmMetaBytes, evmKeys.spendingKey);
  const legacyV1OnBehalfSig = evm.signNameRegistrationOnBehalf(
    'alice',
    evmMetaBytes,
    evmKeys.spendingKey,
    1n,
  );
  const legacyV1ReleaseSig = evm.signNameRelease('alice', evmKeys.spendingKey);

  // Stellar domain vector
  const stellarDomain: SignatureDomain = {
    chain: 'stellar',
    network: Networks.TESTNET,
    contract: stellarNamesContract,
    operation: 'name.register',
    nonce: 1n,
    expiry: 1_900_000_000n,
  };
  const stellarPayload = encodeLengthPrefixedFields([
    UTF8.encode('alice'),
    UTF8.encode(stellarMeta),
  ]);
  const stellarSig = stellar.signStellarDomainAuthorization(
    stellarDomain,
    stellarPayload,
    stellarKeys.spendingKey,
  );

  // Solana domain vector
  const solanaDomain: SignatureDomain = {
    chain: 'solana',
    network: 'solana:devnet',
    contract: solanaNamesProgram,
    operation: 'name.register',
    nonce: 1n,
    expiry: 1_900_000_000n,
  };
  const solanaPayload = encodeLengthPrefixedFields([UTF8.encode('alice'), UTF8.encode(solanaMeta)]);
  const solanaSig = solana.signSolanaDomainAuthorization(
    solanaDomain,
    solanaPayload,
    solanaKeys.spendingKey,
  );

  // CKB domain vector
  const ckbDomain: SignatureDomain = {
    chain: 'ckb',
    network: 'ckb:testnet',
    contract: ckbNamesCodeHash,
    operation: 'name.register',
    nonce: 1n,
    expiry: 1_900_000_000n,
  };
  const ckbPayload = encodeLengthPrefixedFields([UTF8.encode('alice'), UTF8.encode(ckbMeta)]);
  const ckbSig = ckb.signCkbDomainAuthorization(ckbDomain, ckbPayload, ckbKeys.spendingKey);

  // Domain-separated wallet key-derivation prompt vector
  const keyDerivDomain: SignatureDomain = {
    chain: 'evm',
    chainId: 1n,
    network: 'eip155:1',
    contract: '0x0000000000000000000000000000000000006538',
    operation: 'stealth.key_derivation',
    nonce: 0n,
    expiry: 1_900_000_000n,
  };

  return {
    schemaVersion: '1.0.0',
    magic: DOMAIN_AUTH_MAGIC,
    seed: '0x57524149',
    domainSpec: {
      requiredFields: ['chain', 'network', 'contract', 'operation', 'nonce', 'expiry'],
      evmAdditionalFields: ['chainId'],
      evmEncoding:
        'EIP-712 (\\x19\\x01 || domainSeparator || structHash) over EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt) where salt = keccak256(network)',
      binaryFraming:
        'WRAITH-DOMAIN-SIG-V1\\0 || u32be(len(chain)) || chain || u64be(chainId) || u32be(len(network)) || network || u32be(len(contract)) || contract || u32be(len(operation)) || operation || u256be(nonce) || u64be(expiry) || u32be(len(payload)) || payload',
    },
    validVectors: {
      evm: [
        {
          id: 'evm_domain_name_register',
          domain: serializeDomain(evmRegisterDomain),
          payload: evmRegisterPayload,
          signerPubKey: evmKeys.spendingPubKey,
          domainSeparator: evm.computeEvmDomainSeparator(evmRegisterDomain),
          digest: evm.computeEvmNameAuthorizationDigest(evmRegisterDomain, evmRegisterPayload),
          signature: evmRegisterSig,
        },
        {
          id: 'evm_domain_name_update',
          domain: serializeDomain(evmUpdateDomain),
          payload: evmRegisterPayload,
          signerPubKey: evmKeys.spendingPubKey,
          domainSeparator: evm.computeEvmDomainSeparator(evmUpdateDomain),
          digest: evm.computeEvmNameAuthorizationDigest(evmUpdateDomain, evmRegisterPayload),
          signature: evmUpdateSig,
        },
        {
          id: 'evm_domain_name_release',
          domain: serializeDomain(evmReleaseDomain),
          payload: evmReleasePayload,
          signerPubKey: evmKeys.spendingPubKey,
          domainSeparator: evm.computeEvmDomainSeparator(evmReleaseDomain),
          digest: evm.computeEvmNameAuthorizationDigest(evmReleaseDomain, evmReleasePayload),
          signature: evmReleaseSig,
        },
      ],
      stellar: [
        {
          id: 'stellar_domain_name_register',
          domain: serializeDomain(stellarDomain),
          payloadHex: toHex(stellarPayload),
          encodedBytesHex: toHex(encodeDomainAuthorizationBytes(stellarDomain, stellarPayload)),
          digestHex: toHex(
            stellar.computeStellarAuthorizationDigest(stellarDomain, stellarPayload),
          ),
          signerPubKeyHex: toHex(stellarKeys.spendingPubKey),
          signatureHex: toHex(stellarSig),
        },
      ],
      solana: [
        {
          id: 'solana_domain_name_register',
          domain: serializeDomain(solanaDomain),
          payloadHex: toHex(solanaPayload),
          encodedBytesHex: toHex(encodeDomainAuthorizationBytes(solanaDomain, solanaPayload)),
          digestHex: toHex(solana.computeSolanaAuthorizationDigest(solanaDomain, solanaPayload)),
          signerPubKeyHex: toHex(solanaKeys.spendingPubKey),
          signatureHex: toHex(solanaSig),
        },
      ],
      ckb: [
        {
          id: 'ckb_domain_name_register',
          domain: serializeDomain(ckbDomain),
          payloadHex: toHex(ckbPayload),
          encodedBytesHex: toHex(encodeDomainAuthorizationBytes(ckbDomain, ckbPayload)),
          digest: ckb.computeCkbAuthorizationDigest(ckbDomain, ckbPayload),
          signerPubKey: ckbKeys.spendingPubKey,
          signature: ckbSig,
        },
      ],
      walletKeyDerivationPrompt: {
        domain: serializeDomain(keyDerivDomain),
        account: '0x1111111111111111111111111111111111111111',
        message: buildDomainStealthSigningMessage(
          keyDerivDomain,
          '0x1111111111111111111111111111111111111111',
        ),
      },
      legacyV1Compatibility: {
        note: 'Retained through 1.x for deployed v1 contracts; deprecated in favor of signDomainNameAuthorization.',
        name: 'alice',
        metaAddressBytes: evmMetaBytes,
        signerPubKey: evmKeys.spendingPubKey,
        registerSignature: legacyV1RegisterSig,
        registerOnBehalfNonce1Signature: legacyV1OnBehalfSig,
        releaseSignature: legacyV1ReleaseSig,
      },
    },
    replayVectors: [
      {
        id: 'replay_evm_to_ckb_same_secp256k1_curve',
        sourceVectorId: 'evm_domain_name_register',
        targetDomain: serializeDomain(ckbDomain),
        nowSeconds: '1800000000',
        expectedReason: 'CHAIN_MISMATCH',
      },
      {
        id: 'replay_stellar_to_solana_same_ed25519_curve',
        sourceVectorId: 'stellar_domain_name_register',
        targetDomain: serializeDomain(solanaDomain),
        nowSeconds: '1800000000',
        expectedReason: 'CHAIN_MISMATCH',
      },
      {
        id: 'replay_evm_cross_chain_id_horizen_to_mainnet',
        sourceVectorId: 'evm_domain_name_register',
        targetDomain: serializeDomain({
          ...evmRegisterDomain,
          chainId: 1n,
          network: 'eip155:1',
        }),
        nowSeconds: '1800000000',
        expectedReason: 'CHAIN_ID_MISMATCH',
      },
      {
        id: 'replay_stellar_testnet_to_public_network',
        sourceVectorId: 'stellar_domain_name_register',
        targetDomain: serializeDomain({
          ...stellarDomain,
          network: Networks.PUBLIC,
        }),
        nowSeconds: '1800000000',
        expectedReason: 'NETWORK_MISMATCH',
      },
      {
        id: 'replay_evm_cross_contract',
        sourceVectorId: 'evm_domain_name_register',
        targetDomain: serializeDomain({
          ...evmRegisterDomain,
          contract: evm.getDeployment('horizen').contracts.registry,
        }),
        nowSeconds: '1800000000',
        expectedReason: 'CONTRACT_MISMATCH',
      },
      {
        id: 'replay_evm_register_as_update',
        sourceVectorId: 'evm_domain_name_register',
        targetDomain: serializeDomain({
          ...evmRegisterDomain,
          operation: 'name.update',
        }),
        nowSeconds: '1800000000',
        expectedReason: 'OPERATION_MISMATCH',
      },
      {
        id: 'replay_expired_signature',
        sourceVectorId: 'evm_domain_name_register',
        targetDomain: serializeDomain(evmRegisterDomain),
        nowSeconds: '1900000000',
        expectedReason: 'EXPIRED',
      },
      {
        id: 'replay_reused_nonce',
        sourceVectorId: 'evm_domain_name_register',
        targetDomain: serializeDomain(evmRegisterDomain),
        nowSeconds: '1800000000',
        preUsedNonces: ['1'],
        expectedReason: 'NONCE_REUSED',
      },
    ],
  };
}

const outPath = join(OUT_DIR, 'wallet-signatures.json');
writeFileSync(outPath, JSON.stringify(generateWalletSignatureVectors(), null, 2) + '\n');
console.log(`wrote ${outPath}`);
