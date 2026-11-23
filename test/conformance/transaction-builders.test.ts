import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { secp256k1 } from '@noble/curves/secp256k1';
import {
  Address,
  Asset,
  Transaction,
  TransactionBuilder,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { decodeFunctionData, getAddress, keccak256, toBytes, toHex } from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STELLAR_VECTOR_SCHEMA_VERSION,
  TRANSACTION_BUILDER_SCHEMA_VERSION,
  checksums,
  transactionBuilderVectors,
} from '../../packages/test-vectors/index.js';
import { InsufficientBalanceError } from '../../src/errors';
import * as ckb from '../../src/chains/ckb';
import * as evm from '../../src/chains/evm';
import { ANNOUNCER_ABI, SENDER_ABI } from '../../src/chains/evm/abis';
import * as solana from '../../src/chains/solana';
import { base58Encode } from '../../src/chains/solana/utils';
import * as stellar from '../../src/chains/stellar';

const require = createRequire(import.meta.url);
const testVectorsDir = resolve(__dirname, '..', '..', 'packages', 'test-vectors');

function hexToUint8(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function uint8ToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('Transaction-Builder Golden Vectors & Round-Trip Conformance', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes versioned fixtures and verified SHA-256 checksums from @wraith-protocol/test-vectors', () => {
    expect(TRANSACTION_BUILDER_SCHEMA_VERSION).toBe('1.0.0');
    expect(STELLAR_VECTOR_SCHEMA_VERSION).toBe('1.0.0');
    expect(transactionBuilderVectors.schemaVersion).toBe('1.0.0');

    const cjsPkg = require('../../packages/test-vectors/index.cjs');
    const cjsSubpath = require('../../packages/test-vectors/transaction-builders.cjs');
    expect(cjsPkg.TRANSACTION_BUILDER_SCHEMA_VERSION).toBe('1.0.0');
    expect(cjsSubpath.transactionBuilderVectors).toEqual(transactionBuilderVectors);

    expect(checksums.files['vectors/stellar.json']).toMatch(/^[0-9a-f]{64}$/);
    expect(checksums.files['vectors/transaction-builders.json']).toMatch(/^[0-9a-f]{64}$/);

    for (const [relPath, expectedDigest] of Object.entries(checksums.files)) {
      const bytes = readFileSync(join(testVectorsDir, relPath));
      const normalizedLf = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
      const actualDigest = createHash('sha256').update(normalizedLf).digest('hex');
      expect(actualDigest, `unreviewed change in ${relPath}`).toBe(expectedDigest);
    }

    for (const chain of ['evm', 'stellar', 'solana', 'ckb'] as const) {
      const diff = transactionBuilderVectors.chainDifferences[chain];
      expect(diff.envelopeModel.length).toBeGreaterThan(20);
      expect(diff.schemeId.length).toBeGreaterThan(0);
      expect(diff.sendVsAnnounce.length).toBeGreaterThan(20);
    }
  });

  it('rebuilds and round-trips every EVM send and announce golden vector', () => {
    const recipientSig = `0x${'11'.repeat(32)}${'22'.repeat(32)}1b` as const;
    const recipientKeys = evm.deriveStealthKeys(recipientSig);

    for (const vector of transactionBuilderVectors.vectors.evm) {
      if (vector.builder === 'buildSendStealth') {
        const built = evm.buildSendStealth(vector.input);
        expect(built.transaction.to).toBe(vector.output.to);
        expect(built.transaction.data).toBe(vector.output.data);
        expect(built.transaction.data.slice(0, 10)).toBe(vector.output.selector);
        expect(built.transaction.value?.toString()).toBe(vector.output.valueWei);
        expect(built.stealthAddress).toBe(vector.output.stealthAddress);
        expect(built.ephemeralPubKey).toBe(vector.output.ephemeralPubKey);
        expect(built.viewTag).toBe(vector.output.viewTag);

        const decoded = decodeFunctionData({
          abi: SENDER_ABI,
          data: built.transaction.data,
        });
        expect(decoded.functionName).toBe('sendETH');
        const [schemeId, stealthAddress, ephemeralPubKey, metadata] = decoded.args as [
          bigint,
          `0x${string}`,
          `0x${string}`,
          `0x${string}`,
        ];
        expect(schemeId).toBe(evm.SCHEME_ID);
        expect(stealthAddress).toBe(vector.output.stealthAddress);
        expect(ephemeralPubKey).toBe(vector.output.ephemeralPubKey);

        const matches = evm.scanAnnouncements(
          [
            {
              schemeId,
              stealthAddress,
              caller: '0x0000000000000000000000000000000000000001',
              ephemeralPubKey,
              metadata,
            },
          ],
          recipientKeys.viewingKey,
          recipientKeys.spendingPubKey,
          recipientKeys.spendingKey,
        );
        expect(matches).toHaveLength(1);
        const uncompressed = secp256k1.ProjectivePoint.fromPrivateKey(
          toBytes(matches[0].stealthPrivateKey),
        ).toRawBytes(false);
        const derivedAddr = getAddress(`0x${keccak256(toHex(uncompressed.slice(1))).slice(-40)}`);
        expect(derivedAddr).toBe(vector.output.stealthAddress);
      } else if (vector.builder === 'buildSendERC20') {
        const built = evm.buildSendERC20({
          ...vector.input,
          amount: BigInt(vector.input.amount),
        });
        expect(built.transaction.to).toBe(vector.output.to);
        expect(built.transaction.data).toBe(vector.output.data);
        expect(built.transaction.value?.toString()).toBe(vector.output.valueWei);
        expect(built.stealthAddress).toBe(vector.output.stealthAddress);

        const decoded = decodeFunctionData({
          abi: SENDER_ABI,
          data: built.transaction.data,
        });
        expect(decoded.functionName).toBe('sendERC20');
        const [token, amount, schemeId, stealthAddress, ephemeralPubKey, metadata] =
          decoded.args as [
            `0x${string}`,
            bigint,
            bigint,
            `0x${string}`,
            `0x${string}`,
            `0x${string}`,
          ];
        expect(token.toLowerCase()).toBe(vector.input.token.toLowerCase());
        expect(amount.toString()).toBe(vector.input.amount);
        expect(schemeId).toBe(evm.SCHEME_ID);

        const matches = evm.scanAnnouncements(
          [
            {
              schemeId,
              stealthAddress,
              caller: '0x0000000000000000000000000000000000000001',
              ephemeralPubKey,
              metadata,
            },
          ],
          recipientKeys.viewingKey,
          recipientKeys.spendingPubKey,
          recipientKeys.spendingKey,
        );
        expect(matches).toHaveLength(1);
      } else {
        const built = evm.buildAnnounce(vector.input);
        expect(built.to).toBe(vector.output.to);
        expect(built.data).toBe(vector.output.data);
        expect((built.value ?? 0n).toString()).toBe(vector.output.valueWei);

        const decoded = decodeFunctionData({
          abi: ANNOUNCER_ABI,
          data: built.data,
        });
        expect(decoded.functionName).toBe('announce');
        const [schemeId, stealthAddress, ephemeralPubKey, metadata] = decoded.args as [
          bigint,
          `0x${string}`,
          `0x${string}`,
          `0x${string}`,
        ];
        expect(schemeId).toBe(evm.SCHEME_ID);
        expect(stealthAddress).toBe(vector.input.stealthAddress);
        expect(ephemeralPubKey).toBe(vector.input.ephemeralPubKey);
        expect(parseInt(metadata.slice(2), 16)).toBe(vector.input.viewTag);
      }
    }
  });

  it('rebuilds, XDR-decodes, and scans every Stellar golden vector without wall-clock drift', () => {
    const recipientKeys = stellar.deriveStealthKeys(new Uint8Array(64).fill(0x55));

    for (const vector of transactionBuilderVectors.vectors.stellar) {
      const stealthResult = {
        stealthAddress: vector.input.stealthAddress,
        ephemeralPubKey: hexToUint8(vector.input.ephemeralPubKey),
        viewTag: vector.input.viewTag,
      };

      const tx =
        vector.builder === 'buildStealthPayment'
          ? stellar.buildStealthPayment({
              sender: vector.input.sender,
              sequence: vector.input.sequence,
              stealthResult,
              amount: vector.input.amount!,
              asset:
                vector.input.asset === 'native' || !vector.input.asset
                  ? Asset.native()
                  : new Asset(vector.input.asset.code, vector.input.asset.issuer),
              networkPassphrase: vector.input.networkPassphrase,
              fee: vector.input.fee,
              stealthExists: vector.input.stealthExists,
              timeoutSeconds: vector.input.timeoutSeconds,
              timeBounds: vector.input.timeBounds ?? undefined,
            })
          : stellar.buildStealthAnnouncement({
              sender: vector.input.sender,
              sequence: vector.input.sequence,
              stealthResult,
              announcerContract: vector.input.announcerContract!,
              networkPassphrase: vector.input.networkPassphrase,
              fee: vector.input.fee,
              timeoutSeconds: vector.input.timeoutSeconds,
              timeBounds: vector.input.timeBounds ?? undefined,
            });

      expect(tx.toXDR()).toBe(vector.output.envelopeXdrBase64);
      expect(uint8ToHex(tx.hash())).toBe(vector.output.txHashHex);
      expect(tx.source).toBe(vector.output.source);
      expect(tx.sequence).toBe(vector.output.sequence);
      expect(tx.fee).toBe(vector.output.fee);
      expect(tx.timeBounds ?? null).toEqual(vector.output.timeBounds);

      const parsed = TransactionBuilder.fromXDR(
        vector.output.envelopeXdrBase64,
        vector.input.networkPassphrase,
      ) as Transaction;
      expect(uint8ToHex(parsed.hash())).toBe(vector.output.txHashHex);
      expect(parsed.operations).toHaveLength(vector.output.operationCount);
      expect(parsed.operations[0].type).toBe(vector.output.operationType);

      if (vector.builder === 'buildStealthAnnouncement') {
        const op = parsed.operations[0] as unknown as {
          func: xdr.HostFunction;
        };
        const invokeArgs = op.func.invokeContract();
        expect(Address.fromScAddress(invokeArgs.contractAddress()).toString()).toBe(
          vector.input.announcerContract,
        );
        expect(invokeArgs.functionName().toString()).toBe('announce');
        const args = invokeArgs.args();
        expect(scValToNative(args[0])).toBe(stellar.ACTIVE_SCHEME_ID);
        expect(scValToNative(args[1])).toBe(vector.input.stealthAddress);
        const ephBytes = new Uint8Array(args[2].bytes());
        const metaBytes = new Uint8Array(args[3].bytes());
        expect(uint8ToHex(ephBytes)).toBe(vector.input.ephemeralPubKey);
        expect(metaBytes[0]).toBe(vector.input.viewTag);

        const matches = stellar.scanAnnouncements(
          [
            {
              schemeId: Number(scValToNative(args[0])),
              stealthAddress: String(scValToNative(args[1])),
              caller: vector.input.sender,
              ephemeralPubKey: uint8ToHex(ephBytes),
              metadata: uint8ToHex(metaBytes),
            },
          ],
          recipientKeys.viewingKey,
          recipientKeys.spendingPubKey,
          recipientKeys.spendingScalar,
        );
        expect(matches).toHaveLength(1);
      }
    }

    // Prove volatile system clock timestamps cannot alter normalized Stellar vectors.
    const firstVector = transactionBuilderVectors.vectors.stellar[0];
    const stealthResult = {
      stealthAddress: firstVector.input.stealthAddress,
      ephemeralPubKey: hexToUint8(firstVector.input.ephemeralPubKey),
      viewTag: firstVector.input.viewTag,
    };

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
    const tx2020 = stellar.buildStealthPayment({
      sender: firstVector.input.sender,
      sequence: firstVector.input.sequence,
      stealthResult,
      amount: firstVector.input.amount!,
      networkPassphrase: firstVector.input.networkPassphrase,
      timeoutSeconds: 0,
    });

    vi.setSystemTime(new Date('2035-06-15T12:34:56Z'));
    const tx2035 = stellar.buildStealthPayment({
      sender: firstVector.input.sender,
      sequence: firstVector.input.sequence,
      stealthResult,
      amount: firstVector.input.amount!,
      networkPassphrase: firstVector.input.networkPassphrase,
      timeoutSeconds: 0,
    });

    expect(tx2020.toXDR()).toBe(tx2035.toXDR());
    expect(uint8ToHex(tx2020.hash())).toBe(firstVector.output.txHashHex);
  });

  it('rebuilds, Borsh-decodes, and scans every Solana golden vector', () => {
    const recipientKeys = solana.deriveStealthKeys(new Uint8Array(64).fill(0x99));

    for (const vector of transactionBuilderVectors.vectors.solana) {
      if (vector.builder === 'buildSendSol') {
        const built = solana.buildSendSol({
          chain: vector.input.chain,
          recipientMetaAddress: vector.input.recipientMetaAddress!,
          amount: BigInt(vector.input.amount!),
          senderPubkey: vector.input.senderPubkey!,
          ephemeralSeed: hexToUint8(vector.input.ephemeralSeed!),
        });

        expect(built.instruction.programId).toBe(vector.output.programId);
        expect(built.instruction.keys).toEqual(vector.output.keys);
        expect(`0x${uint8ToHex(built.instruction.data)}`).toBe(vector.output.dataHex);
        expect(built.instruction.data.length).toBe(vector.output.dataByteLength);
        expect(built.stealthAddress).toBe(vector.output.stealthAddress);

        const raw = built.instruction.data;
        const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        const lamports = view.getBigUint64(8, true);
        const schemeId = view.getUint32(16, true);
        const stealthAddr = base58Encode(raw.slice(20, 52));
        const ephPub = raw.slice(52, 84);
        const metaLen = view.getUint32(84, true);
        const viewTag = raw[88];

        expect(lamports.toString()).toBe(vector.input.amount);
        expect(schemeId).toBe(solana.SCHEME_ID);
        expect(stealthAddr).toBe(vector.output.stealthAddress);
        expect(metaLen).toBe(1);
        expect(viewTag).toBe(vector.output.viewTag);

        const matches = solana.scanAnnouncements(
          [
            {
              schemeId,
              stealthAddress: stealthAddr,
              caller: vector.input.senderPubkey!,
              ephemeralPubKey: uint8ToHex(ephPub),
              metadata: viewTag.toString(16).padStart(2, '0'),
            },
          ],
          recipientKeys.viewingKey,
          recipientKeys.spendingPubKey,
          recipientKeys.spendingScalar,
        );
        expect(matches).toHaveLength(1);
      } else {
        const built = solana.buildAnnounce({
          chain: vector.input.chain,
          stealthAddress: vector.input.stealthAddress!,
          ephemeralPubKey: hexToUint8(vector.input.ephemeralPubKey!),
          viewTag: vector.input.viewTag!,
          callerPubkey: vector.input.callerPubkey!,
        });

        expect(built.instruction.programId).toBe(vector.output.programId);
        expect(built.instruction.keys).toEqual(vector.output.keys);
        expect(`0x${uint8ToHex(built.instruction.data)}`).toBe(vector.output.dataHex);
        expect(built.instruction.data.length).toBe(vector.output.dataByteLength);

        const raw = built.instruction.data;
        const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        expect(view.getUint32(8, true)).toBe(solana.SCHEME_ID);
        expect(base58Encode(raw.slice(12, 44))).toBe(vector.input.stealthAddress);
        expect(uint8ToHex(raw.slice(44, 76))).toBe(vector.input.ephemeralPubKey);
        expect(view.getUint32(76, true)).toBe(1);
        expect(raw[80]).toBe(vector.input.viewTag);
      }
    }
  });

  it('rebuilds, parses, and scans the CKB stealth cell golden vector', () => {
    const recipientSig = `0x${'dd'.repeat(32)}${'ee'.repeat(32)}1b` as const;
    const recipientKeys = ckb.deriveStealthKeys(recipientSig);

    for (const vector of transactionBuilderVectors.vectors.ckb) {
      const built = ckb.buildSendCkb({
        chain: vector.input.chain,
        recipientMetaAddress: vector.input.recipientMetaAddress,
        capacity: BigInt(vector.input.capacity),
        ephemeralPrivateKey: vector.input.ephemeralPrivateKey,
      });

      expect(built.transaction).toEqual(vector.output.transaction);
      expect(built.stealthPubKey).toBe(vector.output.stealthPubKey);
      expect(built.stealthPubKeyHash).toBe(vector.output.stealthPubKeyHash);
      expect(built.ephemeralPubKey).toBe(vector.output.ephemeralPubKey);
      expect(built.lockArgs).toBe(vector.output.lockArgs);
      expect((built.lockArgs.length - 2) / 2).toBe(53);

      const cellOutput = built.transaction.outputs[0];
      expect(BigInt(cellOutput.capacity).toString()).toBe(vector.input.capacity);
      expect(cellOutput.lock.hashType).toBe('data2');

      const parsedEphPub = `0x${cellOutput.lock.args.slice(2, 68)}` as const;
      const parsedHash = `0x${cellOutput.lock.args.slice(68)}` as const;
      expect(parsedEphPub).toBe(vector.output.ephemeralPubKey);
      expect(parsedHash).toBe(vector.output.stealthPubKeyHash);

      const matches = ckb.scanStealthCells(
        [
          {
            txHash: `0x${'aa'.repeat(32)}`,
            index: 0,
            capacity: BigInt(cellOutput.capacity),
            lockArgs: cellOutput.lock.args,
            ephemeralPubKey: parsedEphPub,
            stealthPubKeyHash: parsedHash,
          },
        ],
        recipientKeys.viewingKey,
        recipientKeys.spendingPubKey,
        recipientKeys.spendingKey,
      );
      expect(matches).toHaveLength(1);
      const pubBytes = secp256k1.getPublicKey(toBytes(matches[0].stealthPrivateKey), true);
      expect(ckb.blake160Hex(pubBytes)).toBe(vector.output.stealthPubKeyHash);
    }

    expect(() =>
      ckb.buildSendCkb({
        recipientMetaAddress: transactionBuilderVectors.vectors.ckb[0].input.recipientMetaAddress,
        capacity: ckb.MIN_STEALTH_CELL_CAPACITY - 1n,
      }),
    ).toThrow(InsufficientBalanceError);
  });
});
