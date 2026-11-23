#!/usr/bin/env tsx
/**
 * Deterministic golden vector generator for multi-chain transaction builders.
 *
 * Produces `vectors/transaction-builders.json` with `schemaVersion: "1.0.0"`,
 * canonical inputs, normalized unsigned outputs (excluding volatile wall-clock
 * timestamps or pinning explicit `timeBounds`), and documented chain-specific
 * serialization differences across EVM, Stellar, Solana, and CKB.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Asset, Keypair, Networks } from '@stellar/stellar-sdk';
import * as ckb from '../../../src/chains/ckb';
import * as evm from '../../../src/chains/evm';
import * as solana from '../../../src/chains/solana';
import * as stellar from '../../../src/chains/stellar';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'vectors');
mkdirSync(OUT_DIR, { recursive: true });

export const TRANSACTION_BUILDER_SCHEMA_VERSION = '1.0.0';

function toHexPrefixed(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function toHexUnprefixed(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function generateTransactionBuilderVectors() {
  // Canonical deterministic seeds (no PRNG state drift across operations)
  const evmRecipientSig = `0x${'11'.repeat(32)}${'22'.repeat(32)}1b` as const;
  const evmEphSendEth = `0x${'33'.repeat(32)}` as const;
  const evmEphSendErc20 = `0x${'44'.repeat(32)}` as const;

  const stellarRecipientSig = new Uint8Array(64).fill(0x55);
  const stellarEphSeed = new Uint8Array(32).fill(0x66);
  const stellarSenderPub = Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(0x77)).publicKey();
  const stellarIssuerPub = Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(0x88)).publicKey();
  const stellarAnnouncerContract = stellar.getDeployment('stellar').contracts.announcer;

  const solanaRecipientSig = new Uint8Array(64).fill(0x99);
  const solanaEphSeed = new Uint8Array(32).fill(0xaa);
  const solanaSenderKeys = solana.deriveStealthKeys(new Uint8Array(64).fill(0xbb));
  const solanaSenderPubkey = solana.generateStealthAddress(
    solanaSenderKeys.spendingPubKey,
    solanaSenderKeys.viewingPubKey,
    new Uint8Array(32).fill(0xcc),
  ).stealthAddress;

  const ckbRecipientSig = `0x${'dd'.repeat(32)}${'ee'.repeat(32)}1b` as const;
  const ckbEphPriv = `0x${'12'.repeat(32)}` as const;

  // ── 1. EVM Vectors ──────────────────────────────────────────────────────────
  const evmRecipientKeys = evm.deriveStealthKeys(evmRecipientSig);
  const evmRecipientMeta = evm.encodeStealthMetaAddress(
    evmRecipientKeys.spendingPubKey,
    evmRecipientKeys.viewingPubKey,
  );

  const evmSendEthInput = {
    chain: 'horizen',
    recipientMetaAddress: evmRecipientMeta,
    amount: '1.5',
    ephemeralPrivateKey: evmEphSendEth,
  };
  const evmSendEthBuilt = evm.buildSendStealth(evmSendEthInput);

  const evmTokenAddress = '0x0000000000000000000000000000000000000abc' as const;
  const evmSendErc20Input = {
    chain: 'horizen',
    recipientMetaAddress: evmRecipientMeta,
    token: evmTokenAddress,
    amount: '2500000',
    gasTip: '0.01',
    ephemeralPrivateKey: evmEphSendErc20,
  };
  const evmSendErc20Built = evm.buildSendERC20({
    ...evmSendErc20Input,
    amount: BigInt(evmSendErc20Input.amount),
  });

  const evmAnnounceInput = {
    chain: 'horizen',
    stealthAddress: evmSendEthBuilt.stealthAddress,
    ephemeralPubKey: evmSendEthBuilt.ephemeralPubKey,
    viewTag: evmSendEthBuilt.viewTag,
  };
  const evmAnnounceBuilt = evm.buildAnnounce(evmAnnounceInput);

  // ── 2. Stellar Vectors ──────────────────────────────────────────────────────
  const stellarRecipientKeys = stellar.deriveStealthKeys(stellarRecipientSig);
  const stellarRecipientMeta = stellar.encodeStealthMetaAddress(
    stellarRecipientKeys.spendingPubKey,
    stellarRecipientKeys.viewingPubKey,
  );
  const stellarStealth = stellar.generateStealthAddress(
    stellarRecipientKeys.spendingPubKey,
    stellarRecipientKeys.viewingPubKey,
    stellarEphSeed,
  );

  const stellarCreateAccountTx = stellar.buildStealthPayment({
    sender: stellarSenderPub,
    sequence: '1000',
    stealthResult: stellarStealth,
    amount: '25.0000000',
    networkPassphrase: Networks.TESTNET,
    fee: '100',
    stealthExists: false,
    timeoutSeconds: 0,
  });

  const normalizedTimeBounds = { minTime: 0, maxTime: 1700000180 };
  const stellarPaymentTx = stellar.buildStealthPayment({
    sender: stellarSenderPub,
    sequence: '1001',
    stealthResult: stellarStealth,
    amount: '10.5000000',
    networkPassphrase: Networks.TESTNET,
    fee: '250',
    stealthExists: true,
    timeBounds: normalizedTimeBounds,
  });

  const usdcAsset = new Asset('USDC', stellarIssuerPub);
  const stellarClaimableTx = stellar.buildStealthPayment({
    sender: stellarSenderPub,
    sequence: '1002',
    stealthResult: stellarStealth,
    amount: '50.0000000',
    asset: usdcAsset,
    networkPassphrase: Networks.TESTNET,
    fee: '100',
    timeoutSeconds: 0,
  });

  const stellarAnnounceTx = stellar.buildStealthAnnouncement({
    sender: stellarSenderPub,
    sequence: '1003',
    stealthResult: stellarStealth,
    announcerContract: stellarAnnouncerContract,
    networkPassphrase: Networks.TESTNET,
    fee: '100',
    timeoutSeconds: 0,
  });

  // ── 3. Solana Vectors ───────────────────────────────────────────────────────
  const solanaRecipientKeys = solana.deriveStealthKeys(solanaRecipientSig);
  const solanaRecipientMeta = solana.encodeStealthMetaAddress(
    solanaRecipientKeys.spendingPubKey,
    solanaRecipientKeys.viewingPubKey,
  );

  const solanaSendInput = {
    chain: 'solana',
    recipientMetaAddress: solanaRecipientMeta,
    amount: '1000000000',
    senderPubkey: solanaSenderPubkey,
    ephemeralSeed: toHexUnprefixed(solanaEphSeed),
  };
  const solanaSendBuilt = solana.buildSendSol({
    chain: solanaSendInput.chain,
    recipientMetaAddress: solanaSendInput.recipientMetaAddress,
    amount: BigInt(solanaSendInput.amount),
    senderPubkey: solanaSendInput.senderPubkey,
    ephemeralSeed: solanaEphSeed,
  });

  const solanaAnnounceInput = {
    chain: 'solana',
    stealthAddress: solanaSendBuilt.stealthAddress,
    ephemeralPubKey: toHexUnprefixed(solanaSendBuilt.ephemeralPubKey),
    viewTag: solanaSendBuilt.viewTag,
    callerPubkey: solanaSenderPubkey,
  };
  const solanaAnnounceBuilt = solana.buildAnnounce({
    chain: solanaAnnounceInput.chain,
    stealthAddress: solanaAnnounceInput.stealthAddress,
    ephemeralPubKey: solanaSendBuilt.ephemeralPubKey,
    viewTag: solanaAnnounceInput.viewTag,
    callerPubkey: solanaAnnounceInput.callerPubkey,
  });

  // ── 4. CKB Vectors ──────────────────────────────────────────────────────────
  const ckbRecipientKeys = ckb.deriveStealthKeys(ckbRecipientSig);
  const ckbRecipientMeta = ckb.encodeStealthMetaAddress(
    ckbRecipientKeys.spendingPubKey,
    ckbRecipientKeys.viewingPubKey,
  );

  const ckbSendInput = {
    chain: 'ckb',
    recipientMetaAddress: ckbRecipientMeta,
    capacity: '10000000000',
    ephemeralPrivateKey: ckbEphPriv,
  };
  const ckbSendBuilt = ckb.buildSendCkb({
    chain: ckbSendInput.chain,
    recipientMetaAddress: ckbSendInput.recipientMetaAddress,
    capacity: BigInt(ckbSendInput.capacity),
    ephemeralPrivateKey: ckbEphPriv,
  });

  return {
    schemaVersion: TRANSACTION_BUILDER_SCHEMA_VERSION,
    seed: '0x57524149',
    timestampPolicy:
      'Volatile wall-clock timestamps are excluded (`timeoutSeconds: 0` -> `timeBounds: null` on Stellar; no blockhash/timestamp in EVM calldata, Solana instructions, or CKB cell skeletons) or normalized explicitly (`timeBounds: { minTime: 0, maxTime: 1700000180 }`).',
    chainDifferences: {
      evm: {
        envelopeModel:
          'ABI-encoded contract calldata (`{ to, data, value }`) without nonce, gasPrice, or block timestamp; wallets populate EIP-1559 envelope fields at signing time.',
        schemeId: '1 (ERC-5564 secp256k1 with 1-byte keccak256 viewTag)',
        sendVsAnnounce:
          '`buildSendStealth` and `buildSendERC20` atomically transfer assets and emit the ERC-5564 Announcement via `WraithSender`; `buildAnnounce` targets `ERC5564Announcer.announce` directly (`value: 0`).',
      },
      stellar: {
        envelopeModel:
          'Full unsigned Stellar Transaction V1 XDR envelope (`TransactionEnvelope` base64 + network-domain SHA-256 `txHash`). Increments `source.sequence` by +1. Default runtime timeout (`180s`) reads `Date.now()`; vectors normalize this via `timeoutSeconds: 0` (`timeBounds: null`) or explicit `timeBounds`.',
        schemeId:
          '2 (Soroban v2 announcer with public view-tag derivation `wraith:stellar:view-tag:v2:`)',
        sendVsAnnounce:
          'Classic value transfer (`CreateAccount` for unfunded native XLM, `Payment` for funded native XLM, `CreateClaimableBalance` for issued tokens without requiring a recipient trustline) is separate from the Soroban `announce` host-function invocation (`buildStealthAnnouncement`).',
      },
      solana: {
        envelopeModel:
          'Unsigned Solana instruction (`{ programId, keys, data }`) with Borsh-encoded little-endian payload and 8-byte Anchor discriminator. `recentBlockhash` and fee-payer message headers are intentionally excluded until submission.',
        schemeId: '1 (ed25519 + X25519 ECDH with 1-byte SHA-256 viewTag)',
        sendVsAnnounce:
          '`buildSendSol` atomically transfers lamports via CPI to `SystemProgram` and logs `AnnouncementEvent` (89-byte data); `buildAnnounce` invokes `wraith-announcer` standalone (81-byte data).',
      },
      ckb: {
        envelopeModel:
          'Unsigned CKB Cell/UTXO transaction skeleton (`{ version, cellDeps, headerDeps, outputs, outputsData }`) with `0x`-prefixed quantity hex capacity and `data2` lock script.',
        schemeId: '1 (secp256k1 ECDH + SHA-256 scalar + blake160 pubkey hash; no 1-byte viewTag)',
        sendVsAnnounce:
          'Single combined `send_and_announce` operation (`buildSendCkb`): in CKB’s Cell model the live output cell’s 53-byte `lock.args` (`ephemeral_pub (33B) || blake160(stealth_pub) (20B)`) IS the on-chain announcement, so no separate announcer contract exists.',
      },
    },
    vectors: {
      evm: [
        {
          id: 'evm_send_eth',
          operation: 'send',
          builder: 'buildSendStealth',
          input: evmSendEthInput,
          output: {
            to: evmSendEthBuilt.transaction.to,
            data: evmSendEthBuilt.transaction.data,
            selector: evmSendEthBuilt.transaction.data.slice(0, 10),
            valueWei: evmSendEthBuilt.transaction.value!.toString(),
            stealthAddress: evmSendEthBuilt.stealthAddress,
            ephemeralPubKey: evmSendEthBuilt.ephemeralPubKey,
            viewTag: evmSendEthBuilt.viewTag,
          },
        },
        {
          id: 'evm_send_erc20',
          operation: 'send_erc20',
          builder: 'buildSendERC20',
          input: evmSendErc20Input,
          output: {
            to: evmSendErc20Built.transaction.to,
            data: evmSendErc20Built.transaction.data,
            selector: evmSendErc20Built.transaction.data.slice(0, 10),
            valueWei: evmSendErc20Built.transaction.value!.toString(),
            stealthAddress: evmSendErc20Built.stealthAddress,
            ephemeralPubKey: evmSendErc20Built.ephemeralPubKey,
            viewTag: evmSendErc20Built.viewTag,
          },
        },
        {
          id: 'evm_announce',
          operation: 'announce',
          builder: 'buildAnnounce',
          input: evmAnnounceInput,
          output: {
            to: evmAnnounceBuilt.to,
            data: evmAnnounceBuilt.data,
            selector: evmAnnounceBuilt.data.slice(0, 10),
            valueWei: '0',
          },
        },
      ],
      stellar: [
        {
          id: 'stellar_send_xlm_create_account',
          operation: 'send_create_account',
          builder: 'buildStealthPayment',
          input: {
            sender: stellarSenderPub,
            sequence: '1000',
            recipientMetaAddress: stellarRecipientMeta,
            ephemeralSeed: toHexUnprefixed(stellarEphSeed),
            stealthAddress: stellarStealth.stealthAddress,
            ephemeralPubKey: toHexUnprefixed(stellarStealth.ephemeralPubKey),
            viewTag: stellarStealth.viewTag,
            amount: '25.0000000',
            asset: 'native',
            networkPassphrase: Networks.TESTNET,
            fee: '100',
            stealthExists: false,
            timeoutSeconds: 0,
            timeBounds: null,
          },
          output: {
            envelopeXdrBase64: stellarCreateAccountTx.toXDR(),
            txHashHex: toHexUnprefixed(stellarCreateAccountTx.hash()),
            source: stellarCreateAccountTx.source,
            sequence: stellarCreateAccountTx.sequence,
            fee: stellarCreateAccountTx.fee,
            timeBounds: stellarCreateAccountTx.timeBounds ?? null,
            operationCount: stellarCreateAccountTx.operations.length,
            operationType: stellarCreateAccountTx.operations[0].type,
          },
        },
        {
          id: 'stellar_send_xlm_payment_normalized_timebounds',
          operation: 'send_payment',
          builder: 'buildStealthPayment',
          input: {
            sender: stellarSenderPub,
            sequence: '1001',
            recipientMetaAddress: stellarRecipientMeta,
            ephemeralSeed: toHexUnprefixed(stellarEphSeed),
            stealthAddress: stellarStealth.stealthAddress,
            ephemeralPubKey: toHexUnprefixed(stellarStealth.ephemeralPubKey),
            viewTag: stellarStealth.viewTag,
            amount: '10.5000000',
            asset: 'native',
            networkPassphrase: Networks.TESTNET,
            fee: '250',
            stealthExists: true,
            timeBounds: normalizedTimeBounds,
          },
          output: {
            envelopeXdrBase64: stellarPaymentTx.toXDR(),
            txHashHex: toHexUnprefixed(stellarPaymentTx.hash()),
            source: stellarPaymentTx.source,
            sequence: stellarPaymentTx.sequence,
            fee: stellarPaymentTx.fee,
            timeBounds: stellarPaymentTx.timeBounds,
            operationCount: stellarPaymentTx.operations.length,
            operationType: stellarPaymentTx.operations[0].type,
          },
        },
        {
          id: 'stellar_send_issued_claimable_balance',
          operation: 'send_issued_asset',
          builder: 'buildStealthPayment',
          input: {
            sender: stellarSenderPub,
            sequence: '1002',
            recipientMetaAddress: stellarRecipientMeta,
            ephemeralSeed: toHexUnprefixed(stellarEphSeed),
            stealthAddress: stellarStealth.stealthAddress,
            ephemeralPubKey: toHexUnprefixed(stellarStealth.ephemeralPubKey),
            viewTag: stellarStealth.viewTag,
            amount: '50.0000000',
            asset: { code: 'USDC', issuer: stellarIssuerPub },
            networkPassphrase: Networks.TESTNET,
            fee: '100',
            stealthExists: false,
            timeoutSeconds: 0,
            timeBounds: null,
          },
          output: {
            envelopeXdrBase64: stellarClaimableTx.toXDR(),
            txHashHex: toHexUnprefixed(stellarClaimableTx.hash()),
            source: stellarClaimableTx.source,
            sequence: stellarClaimableTx.sequence,
            fee: stellarClaimableTx.fee,
            timeBounds: stellarClaimableTx.timeBounds ?? null,
            operationCount: stellarClaimableTx.operations.length,
            operationType: stellarClaimableTx.operations[0].type,
          },
        },
        {
          id: 'stellar_announce_soroban',
          operation: 'announce',
          builder: 'buildStealthAnnouncement',
          input: {
            sender: stellarSenderPub,
            sequence: '1003',
            stealthAddress: stellarStealth.stealthAddress,
            ephemeralPubKey: toHexUnprefixed(stellarStealth.ephemeralPubKey),
            viewTag: stellarStealth.viewTag,
            announcerContract: stellarAnnouncerContract,
            networkPassphrase: Networks.TESTNET,
            fee: '100',
            timeoutSeconds: 0,
            timeBounds: null,
          },
          output: {
            envelopeXdrBase64: stellarAnnounceTx.toXDR(),
            txHashHex: toHexUnprefixed(stellarAnnounceTx.hash()),
            source: stellarAnnounceTx.source,
            sequence: stellarAnnounceTx.sequence,
            fee: stellarAnnounceTx.fee,
            timeBounds: stellarAnnounceTx.timeBounds ?? null,
            operationCount: stellarAnnounceTx.operations.length,
            operationType: stellarAnnounceTx.operations[0].type,
            schemeId: stellar.ACTIVE_SCHEME_ID,
          },
        },
      ],
      solana: [
        {
          id: 'solana_send_sol',
          operation: 'send',
          builder: 'buildSendSol',
          input: solanaSendInput,
          output: {
            programId: solanaSendBuilt.instruction.programId,
            keys: solanaSendBuilt.instruction.keys,
            dataHex: toHexPrefixed(solanaSendBuilt.instruction.data),
            discriminatorHex: toHexPrefixed(solanaSendBuilt.instruction.data.slice(0, 8)),
            dataByteLength: solanaSendBuilt.instruction.data.length,
            stealthAddress: solanaSendBuilt.stealthAddress,
            ephemeralPubKey: toHexUnprefixed(solanaSendBuilt.ephemeralPubKey),
            viewTag: solanaSendBuilt.viewTag,
          },
        },
        {
          id: 'solana_announce',
          operation: 'announce',
          builder: 'buildAnnounce',
          input: solanaAnnounceInput,
          output: {
            programId: solanaAnnounceBuilt.instruction.programId,
            keys: solanaAnnounceBuilt.instruction.keys,
            dataHex: toHexPrefixed(solanaAnnounceBuilt.instruction.data),
            discriminatorHex: toHexPrefixed(solanaAnnounceBuilt.instruction.data.slice(0, 8)),
            dataByteLength: solanaAnnounceBuilt.instruction.data.length,
          },
        },
      ],
      ckb: [
        {
          id: 'ckb_send_and_announce_cell',
          operation: 'send_and_announce',
          builder: 'buildSendCkb',
          input: ckbSendInput,
          output: {
            transaction: ckbSendBuilt.transaction,
            stealthPubKey: ckbSendBuilt.stealthPubKey,
            stealthPubKeyHash: ckbSendBuilt.stealthPubKeyHash,
            ephemeralPubKey: ckbSendBuilt.ephemeralPubKey,
            lockArgs: ckbSendBuilt.lockArgs,
            lockArgsByteLength: (ckbSendBuilt.lockArgs.length - 2) / 2,
          },
        },
      ],
    },
  };
}

const outPath = join(OUT_DIR, 'transaction-builders.json');
const payload = generateTransactionBuilderVectors();
writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
console.log(`wrote ${outPath}`);
