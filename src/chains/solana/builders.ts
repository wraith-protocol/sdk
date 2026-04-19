import { sha256 } from '@noble/hashes/sha256';
import { generateStealthAddress } from './stealth';
import { decodeStealthMetaAddress } from './meta-address';
import { getDeployment } from './deployments';
import { SCHEME_ID } from './constants';
import type { GeneratedStealthAddress } from './types';

/** A serialized Solana instruction ready to add to a Transaction. */
export interface SolanaInstruction {
  programId: string;
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: Uint8Array;
}

export interface BuildSendSolResult {
  stealthAddress: string;
  ephemeralPubKey: Uint8Array;
  viewTag: number;
  instruction: SolanaInstruction;
}

export interface BuildAnnounceResult {
  instruction: SolanaInstruction;
}

export interface BuildRegisterNameResult {
  nameRecordPDA: string;
  instruction: SolanaInstruction;
}

export interface BuildUpdateNameResult {
  nameRecordPDA: string;
  instruction: SolanaInstruction;
}

export interface BuildReleaseNameResult {
  nameRecordPDA: string;
  instruction: SolanaInstruction;
}

export interface BuildResolveNameResult {
  nameRecordPDA: string;
  instruction: SolanaInstruction;
}

// --- Instruction discriminators from IDL ---
const SEND_SOL_DISC = new Uint8Array([214, 24, 219, 18, 3, 205, 201, 179]);
const ANNOUNCE_DISC = new Uint8Array([7, 30, 100, 250, 110, 253, 3, 149]);
const REGISTER_DISC = new Uint8Array([211, 124, 67, 15, 211, 194, 178, 240]);
const UPDATE_DISC = new Uint8Array([219, 200, 88, 176, 158, 63, 253, 127]);
const RELEASE_DISC = new Uint8Array([253, 249, 15, 206, 28, 127, 193, 241]);
const RESOLVE_DISC = new Uint8Array([246, 150, 236, 206, 108, 63, 58, 10]);

const SYSTEM_PROGRAM = '11111111111111111111111111111111';

/**
 * Builds a Solana instruction to send SOL privately via the wraith-sender program.
 * Atomic transfer + announcement in a single transaction.
 */
export function buildSendSol(params: {
  recipientMetaAddress: string;
  amount: bigint;
  senderPubkey: string;
  chain?: string;
}): BuildSendSolResult {
  const { recipientMetaAddress, amount, senderPubkey, chain = 'solana' } = params;
  const deployment = getDeployment(chain);
  const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(recipientMetaAddress);
  const stealth = generateStealthAddress(spendingPubKey, viewingPubKey);

  const data = serializeSendSolData(amount, stealth);

  return {
    stealthAddress: stealth.stealthAddress,
    ephemeralPubKey: stealth.ephemeralPubKey,
    viewTag: stealth.viewTag,
    instruction: {
      programId: deployment.contracts.sender,
      keys: [
        { pubkey: senderPubkey, isSigner: true, isWritable: true },
        { pubkey: stealth.stealthAddress, isSigner: false, isWritable: true },
        { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      ],
      data,
    },
  };
}

/**
 * Builds a Solana instruction to announce a stealth address via the wraith-announcer program.
 * Use this if you sent assets directly and need to publish the announcement separately.
 */
export function buildAnnounce(params: {
  stealthAddress: string;
  ephemeralPubKey: Uint8Array;
  viewTag: number;
  callerPubkey: string;
  chain?: string;
}): BuildAnnounceResult {
  const { stealthAddress, ephemeralPubKey, viewTag, callerPubkey, chain = 'solana' } = params;
  const deployment = getDeployment(chain);

  // discriminator (8) + scheme_id (4) + stealth_address (32) + ephemeral_pub_key (32) + metadata vec (4 + 1) = 81
  const buf = new Uint8Array(81);
  const view = new DataView(buf.buffer);
  let offset = 0;

  buf.set(ANNOUNCE_DISC, offset);
  offset += 8;

  view.setUint32(offset, SCHEME_ID, true);
  offset += 4;

  buf.set(base58Decode(stealthAddress), offset);
  offset += 32;

  buf.set(ephemeralPubKey, offset);
  offset += 32;

  view.setUint32(offset, 1, true);
  offset += 4;
  buf[offset] = viewTag;

  return {
    instruction: {
      programId: deployment.contracts.announcer,
      keys: [{ pubkey: callerPubkey, isSigner: true, isWritable: true }],
      data: buf,
    },
  };
}

/**
 * Builds a Solana instruction to register a .wraith name.
 * Creates a PDA account seeded by ["name", name_bytes].
 */
export function buildRegisterName(params: {
  name: string;
  metaAddress: Uint8Array;
  ownerPubkey: string;
  chain?: string;
}): BuildRegisterNameResult {
  const { name, metaAddress, ownerPubkey, chain = 'solana' } = params;
  const deployment = getDeployment(chain);
  const cleanName = name.replace(/\.wraith$/, '');

  if (metaAddress.length !== 64) {
    throw new Error('Meta-address must be 64 bytes (spending_pub || viewing_pub)');
  }

  const pda = derivePDA(cleanName, deployment.contracts.names);

  const nameBytes = new TextEncoder().encode(cleanName);
  // discriminator (8) + name string (4 + len) + meta_address (64)
  const buf = new Uint8Array(8 + 4 + nameBytes.length + 64);
  const view = new DataView(buf.buffer);
  let offset = 0;

  buf.set(REGISTER_DISC, offset);
  offset += 8;

  // borsh string: 4-byte length + utf-8 bytes
  view.setUint32(offset, nameBytes.length, true);
  offset += 4;
  buf.set(nameBytes, offset);
  offset += nameBytes.length;

  // [u8; 64] meta_address
  buf.set(metaAddress, offset);

  return {
    nameRecordPDA: pda,
    instruction: {
      programId: deployment.contracts.names,
      keys: [
        { pubkey: pda, isSigner: false, isWritable: true },
        { pubkey: ownerPubkey, isSigner: true, isWritable: true },
        { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      ],
      data: buf,
    },
  };
}

/**
 * Builds a Solana instruction to update a .wraith name's meta-address.
 * Only the owner can call this.
 */
export function buildUpdateName(params: {
  name: string;
  newMetaAddress: Uint8Array;
  ownerPubkey: string;
  chain?: string;
}): BuildUpdateNameResult {
  const { name, newMetaAddress, ownerPubkey, chain = 'solana' } = params;
  const deployment = getDeployment(chain);
  const cleanName = name.replace(/\.wraith$/, '');

  if (newMetaAddress.length !== 64) {
    throw new Error('Meta-address must be 64 bytes (spending_pub || viewing_pub)');
  }

  const pda = derivePDA(cleanName, deployment.contracts.names);

  // discriminator (8) + [u8; 64]
  const buf = new Uint8Array(8 + 64);
  buf.set(UPDATE_DISC, 0);
  buf.set(newMetaAddress, 8);

  return {
    nameRecordPDA: pda,
    instruction: {
      programId: deployment.contracts.names,
      keys: [
        { pubkey: pda, isSigner: false, isWritable: true },
        { pubkey: ownerPubkey, isSigner: true, isWritable: false },
      ],
      data: buf,
    },
  };
}

/**
 * Builds a Solana instruction to release a .wraith name.
 * Closes the PDA account and returns rent to the owner.
 */
export function buildReleaseName(params: {
  name: string;
  ownerPubkey: string;
  chain?: string;
}): BuildReleaseNameResult {
  const { name, ownerPubkey, chain = 'solana' } = params;
  const deployment = getDeployment(chain);
  const cleanName = name.replace(/\.wraith$/, '');
  const pda = derivePDA(cleanName, deployment.contracts.names);

  return {
    nameRecordPDA: pda,
    instruction: {
      programId: deployment.contracts.names,
      keys: [
        { pubkey: pda, isSigner: false, isWritable: true },
        { pubkey: ownerPubkey, isSigner: true, isWritable: true },
      ],
      data: Uint8Array.from(RELEASE_DISC),
    },
  };
}

/**
 * Builds a Solana instruction to resolve a .wraith name to its meta-address.
 * This is a read-only instruction — use with simulateTransaction.
 */
export function buildResolveName(params: { name: string; chain?: string }): BuildResolveNameResult {
  const { name, chain = 'solana' } = params;
  const deployment = getDeployment(chain);
  const cleanName = name.replace(/\.wraith$/, '');
  const pda = derivePDA(cleanName, deployment.contracts.names);

  return {
    nameRecordPDA: pda,
    instruction: {
      programId: deployment.contracts.names,
      keys: [{ pubkey: pda, isSigner: false, isWritable: false }],
      data: Uint8Array.from(RESOLVE_DISC),
    },
  };
}

// --- Internal helpers ---

function serializeSendSolData(amount: bigint, stealth: GeneratedStealthAddress): Uint8Array {
  // discriminator (8) + amount (8) + scheme_id (4) + stealth_address (32) + ephemeral_pub_key (32) + metadata vec (4 + 1) = 89
  const buf = new Uint8Array(89);
  const view = new DataView(buf.buffer);
  let offset = 0;

  buf.set(SEND_SOL_DISC, offset);
  offset += 8;

  // u64 LE
  view.setBigUint64(offset, amount, true);
  offset += 8;

  // u32 LE
  view.setUint32(offset, SCHEME_ID, true);
  offset += 4;

  // stealth_address (32 bytes - base58 decoded)
  buf.set(base58Decode(stealth.stealthAddress), offset);
  offset += 32;

  // ephemeral_pub_key (32 bytes)
  buf.set(stealth.ephemeralPubKey, offset);
  offset += 32;

  // metadata: borsh Vec<u8> = 4-byte length + data
  view.setUint32(offset, 1, true);
  offset += 4;
  buf[offset] = stealth.viewTag;

  return buf;
}

/**
 * Derives a PDA for a .wraith name: seeds = ["name", name_bytes].
 */
function derivePDA(name: string, programId: string): string {
  const nameBytes = new TextEncoder().encode(name);
  const programIdBytes = base58Decode(programId);
  const pdaMarker = new TextEncoder().encode('ProgramDerivedAddress');
  const seedPrefix = new TextEncoder().encode('name');

  for (let bump = 255; bump >= 0; bump--) {
    const input = new Uint8Array(
      seedPrefix.length + nameBytes.length + 1 + programIdBytes.length + pdaMarker.length,
    );
    let offset = 0;
    input.set(seedPrefix, offset);
    offset += seedPrefix.length;
    input.set(nameBytes, offset);
    offset += nameBytes.length;
    input[offset] = bump;
    offset += 1;
    input.set(programIdBytes, offset);
    offset += programIdBytes.length;
    input.set(pdaMarker, offset);

    const result = sha256(input);
    return base58Encode(result);
  }

  throw new Error(`Could not find valid PDA bump for name: ${name}`);
}

function base58Decode(str: string): Uint8Array {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let result = 0n;
  for (const char of str) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base58 character: ${char}`);
    result = result * 58n + BigInt(idx);
  }
  const hex = result.toString(16).padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function base58Encode(buf: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = 0n;
  for (const byte of buf) {
    num = num * 256n + BigInt(byte);
  }
  const chars: string[] = [];
  while (num > 0n) {
    const rem = Number(num % 58n);
    chars.unshift(ALPHABET[rem]);
    num = num / 58n;
  }
  for (const byte of buf) {
    if (byte === 0) chars.unshift('1');
    else break;
  }
  return chars.join('');
}
