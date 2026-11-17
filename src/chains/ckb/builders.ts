import { InsufficientBalanceError } from '../../errors';
import { getDeployment } from './deployments';
import { decodeStealthMetaAddress } from './meta-address';
import { generateStealthAddress } from './stealth';
import type { HexString } from './types';

/**
 * Minimum capacity required for a live CKB stealth-lock cell in shannons
 * (8-byte capacity + 32-byte codeHash + 1-byte hashType + 53-byte args = 94 CKB).
 */
export const MIN_STEALTH_CELL_CAPACITY = 9_400_000_000n;

/** CKB transaction outpoint reference. */
export interface CKBOutPoint {
  txHash: HexString;
  index: HexString;
}

/** CKB transaction cell dependency descriptor. */
export interface CKBCellDep {
  outPoint: CKBOutPoint;
  depType: 'code' | 'depGroup';
}

/** CKB lock or type script descriptor. */
export interface CKBScript {
  codeHash: HexString;
  hashType: 'data' | 'type' | 'data1' | 'data2';
  args: HexString;
}

/** CKB cell output descriptor. */
export interface CKBCellOutput {
  capacity: HexString;
  lock: CKBScript;
  type?: CKBScript | null;
}

/**
 * Normalized unsigned CKB stealth send + announce transaction skeleton.
 *
 * On CKB (Cell/UTXO model), there is no separate announcer contract: the live
 * stealth cell output itself carries `ephemeral_pub (33B) || blake160(stealth_pub) (20B)`
 * in `lock.args`. Callers attach funding `inputs`, any change output, and
 * witnesses before signing.
 */
export interface UnsignedCKBStealthTx {
  version: HexString;
  cellDeps: CKBCellDep[];
  headerDeps: HexString[];
  outputs: CKBCellOutput[];
  outputsData: HexString[];
}

/** Parameters for {@link buildSendCkb}. */
export interface BuildSendCkbParams {
  /** Recipient stealth meta-address (`st:ckb:0x...`). */
  recipientMetaAddress: string;
  /** Output cell capacity in shannons (`>= MIN_STEALTH_CELL_CAPACITY`). */
  capacity: bigint;
  /** Optional chain deployment identifier (default: `"ckb"`). */
  chain?: string;
  /** Optional fixed 32-byte ephemeral private key for deterministic testing/vectors. */
  ephemeralPrivateKey?: HexString;
}

/** Result returned by {@link buildSendCkb}. */
export interface BuildSendCkbResult {
  transaction: UnsignedCKBStealthTx;
  stealthPubKey: HexString;
  stealthPubKeyHash: HexString;
  ephemeralPubKey: HexString;
  lockArgs: HexString;
}

function toQuantityHex(value: number | bigint): HexString {
  return `0x${BigInt(value).toString(16)}` as HexString;
}

/**
 * Builds a deterministic unsigned CKB stealth cell transaction skeleton.
 *
 * Because CKB uses a Cell/UTXO model, the output cell's `stealth-lock` script
 * simultaneously transfers `capacity` shannons and publishes the 53-byte
 * announcement payload (`ephemeral_pub || blake160(stealth_pub)`).
 *
 * @throws {InsufficientBalanceError} If `capacity < MIN_STEALTH_CELL_CAPACITY`.
 */
export function buildSendCkb(params: BuildSendCkbParams): BuildSendCkbResult {
  const { recipientMetaAddress, capacity, chain = 'ckb', ephemeralPrivateKey } = params;

  if (capacity < MIN_STEALTH_CELL_CAPACITY) {
    throw new InsufficientBalanceError(MIN_STEALTH_CELL_CAPACITY, capacity, 'CKB');
  }

  const deployment = getDeployment(chain);
  const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(recipientMetaAddress);
  const stealth = generateStealthAddress(spendingPubKey, viewingPubKey, ephemeralPrivateKey);

  const cellDeps: CKBCellDep[] = [
    {
      outPoint: {
        txHash: deployment.cellDeps.stealthLock.txHash as HexString,
        index: toQuantityHex(deployment.cellDeps.stealthLock.index),
      },
      depType: 'code',
    },
    {
      outPoint: {
        txHash: deployment.cellDeps.ckbAuth.txHash as HexString,
        index: toQuantityHex(deployment.cellDeps.ckbAuth.index),
      },
      depType: 'code',
    },
  ];

  const output: CKBCellOutput = {
    capacity: toQuantityHex(capacity),
    lock: {
      codeHash: deployment.contracts.stealthLockCodeHash as HexString,
      hashType: 'data2',
      args: stealth.lockArgs,
    },
    type: null,
  };

  return {
    transaction: {
      version: '0x0',
      cellDeps,
      headerDeps: [],
      outputs: [output],
      outputsData: ['0x'],
    },
    stealthPubKey: stealth.stealthPubKey,
    stealthPubKeyHash: stealth.stealthPubKeyHash,
    ephemeralPubKey: stealth.ephemeralPubKey,
    lockArgs: stealth.lockArgs,
  };
}
