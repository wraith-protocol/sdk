import { blake2b } from '@noble/hashes/blake2b';
import { toHex, toBytes } from 'viem';
import { getDeployment } from './deployments';
import { META_ADDRESS_PREFIX } from './constants';
import type { HexString } from './types';

/** Valid .wraith name pattern: 3-32 chars, lowercase alphanumeric and hyphens. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

/** CKB personalization string for blake2b hashing. */
const CKB_PERSONALIZATION = new TextEncoder().encode('ckb-default-hash');

/**
 * Validates a .wraith name.
 * Names must be 3-32 characters, lowercase alphanumeric and hyphens only.
 *
 * @throws If the name is invalid.
 */
function validateName(name: string): void {
  if (name.length < 3 || name.length > 32) {
    throw new Error(`Name must be between 3 and 32 characters, got ${name.length}`);
  }
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      'Name must contain only lowercase alphanumeric characters and hyphens, and must not start or end with a hyphen',
    );
  }
}

/**
 * Computes the blake2b hash of a .wraith name to use as the type script args.
 *
 * blake2b(nameBytes, personalization="ckb-default-hash", dkLen=32)[0:32]
 *
 * @param name The .wraith name to hash.
 * @returns The 32-byte hash as a 0x-prefixed hex string.
 * @throws If the name is invalid.
 */
export function hashName(name: string): HexString {
  validateName(name);
  const nameBytes = new TextEncoder().encode(name);
  const hash = blake2b(nameBytes, {
    personalization: CKB_PERSONALIZATION,
    dkLen: 32,
  });
  return toHex(hash) as HexString;
}

/**
 * Builds the type script and cell data needed to register a .wraith name on CKB.
 *
 * The cell data is the concatenation of spending_pub (33 bytes) and viewing_pub (33 bytes),
 * totaling 66 bytes.
 *
 * @param params.name The .wraith name to register.
 * @param params.spendingPubKey The 33-byte compressed spending public key.
 * @param params.viewingPubKey The 33-byte compressed viewing public key.
 * @param params.chain Optional chain identifier for deployment lookup (default: "ckb").
 * @returns The type script descriptor and cell data hex.
 */
export function buildRegisterName(params: {
  name: string;
  spendingPubKey: HexString;
  viewingPubKey: HexString;
  chain?: string;
}): {
  typeScript: { codeHash: HexString; hashType: string; args: HexString };
  data: HexString;
} {
  const { name, spendingPubKey, viewingPubKey, chain } = params;
  const deployment = getDeployment(chain);
  const nameHash = hashName(name);

  const spendBytes = toBytes(spendingPubKey);
  const viewBytes = toBytes(viewingPubKey);

  if (spendBytes.length !== 33) {
    throw new Error(`Spending public key must be 33 bytes (compressed), got ${spendBytes.length}`);
  }
  if (viewBytes.length !== 33) {
    throw new Error(`Viewing public key must be 33 bytes (compressed), got ${viewBytes.length}`);
  }

  const dataBytes = new Uint8Array(66);
  dataBytes.set(spendBytes, 0);
  dataBytes.set(viewBytes, 33);

  return {
    typeScript: {
      codeHash: deployment.contracts.namesTypeCodeHash as HexString,
      hashType: 'type',
      args: nameHash,
    },
    data: toHex(dataBytes) as HexString,
  };
}

/**
 * Builds the type script needed to resolve a .wraith name on CKB.
 *
 * Callers use this with CKB RPC `get_cells` to find the name Cell.
 *
 * @param params.name The .wraith name to resolve.
 * @param params.chain Optional chain identifier for deployment lookup (default: "ckb").
 * @returns The type script descriptor to query for.
 */
export function buildResolveName(params: { name: string; chain?: string }): {
  typeScript: { codeHash: HexString; hashType: string; args: HexString };
} {
  const { name, chain } = params;
  const deployment = getDeployment(chain);
  const nameHash = hashName(name);

  return {
    typeScript: {
      codeHash: deployment.contracts.namesTypeCodeHash as HexString,
      hashType: 'type',
      args: nameHash,
    },
  };
}

/**
 * Parses 66-byte name cell data into a stealth meta-address.
 *
 * The cell data layout is:
 *   - bytes [0:33)  spending public key (33 bytes, compressed secp256k1)
 *   - bytes [33:66) viewing public key  (33 bytes, compressed secp256k1)
 *
 * @param data The 0x-prefixed hex string of the cell data (66 bytes = 132 hex chars).
 * @returns The encoded stealth meta-address in "st:ckb:..." format.
 * @throws If the data is not exactly 66 bytes.
 */
export function metaAddressFromNameData(data: HexString): string {
  const dataBytes = toBytes(data);
  if (dataBytes.length !== 66) {
    throw new Error(`Name cell data must be exactly 66 bytes, got ${dataBytes.length}`);
  }

  const spendHex = toHex(dataBytes.slice(0, 33)).slice(2);
  const viewHex = toHex(dataBytes.slice(33, 66)).slice(2);

  return `${META_ADDRESS_PREFIX}${spendHex}${viewHex}`;
}
