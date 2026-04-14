import { encodeFunctionData, parseEther } from 'viem';
import type { HexString } from './types';
import { SCHEME_ID } from './constants';
import { generateStealthAddress } from './stealth';
import { decodeStealthMetaAddress } from './meta-address';
import { encodeStealthMetaAddress } from './meta-address';
import { signNameRegistration, signNameUpdate, signNameRelease, metaAddressToBytes } from './names';
import { getDeployment } from './deployments';
import { SENDER_ABI, NAMES_ABI, REGISTRY_ABI, ANNOUNCER_ABI } from './abis';
import type { StealthKeys } from './types';

export interface TransactionData {
  to: HexString;
  data: HexString;
  value?: bigint;
}

export interface BuildSendStealthResult {
  transaction: TransactionData;
  stealthAddress: HexString;
  ephemeralPubKey: HexString;
  viewTag: number;
}

/**
 * Builds a transaction to send ETH privately via a stealth address.
 * Uses the WraithSender contract for atomic send + announce.
 *
 * Returns the transaction data and the generated stealth address info.
 * Submit the transaction with any library (viem, ethers, wagmi, etc.).
 */
export function buildSendStealth(params: {
  recipientMetaAddress: string;
  amount: string;
  chain: string;
}): BuildSendStealthResult {
  const { recipientMetaAddress, amount, chain } = params;
  const deployment = getDeployment(chain);
  const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(recipientMetaAddress);
  const stealth = generateStealthAddress(spendingPubKey, viewingPubKey);
  const viewTagHex = stealth.viewTag.toString(16).padStart(2, '0');

  const data = encodeFunctionData({
    abi: SENDER_ABI,
    functionName: 'sendETH',
    args: [
      SCHEME_ID,
      stealth.stealthAddress,
      stealth.ephemeralPubKey,
      `0x${viewTagHex}` as HexString,
    ],
  });

  return {
    transaction: {
      to: deployment.contracts.sender,
      data: data as HexString,
      value: parseEther(amount),
    },
    stealthAddress: stealth.stealthAddress,
    ephemeralPubKey: stealth.ephemeralPubKey,
    viewTag: stealth.viewTag,
  };
}

/**
 * Builds a transaction to send an ERC-20 token privately via a stealth address.
 * The sender must have approved the WraithSender contract to spend the token.
 *
 * @param gasTip Optional ETH amount to include as gas tip for the stealth address.
 */
export function buildSendERC20(params: {
  recipientMetaAddress: string;
  token: HexString;
  amount: bigint;
  chain: string;
  gasTip?: string;
}): BuildSendStealthResult {
  const { recipientMetaAddress, token, amount, chain, gasTip } = params;
  const deployment = getDeployment(chain);
  const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(recipientMetaAddress);
  const stealth = generateStealthAddress(spendingPubKey, viewingPubKey);
  const viewTagHex = stealth.viewTag.toString(16).padStart(2, '0');

  const data = encodeFunctionData({
    abi: SENDER_ABI,
    functionName: 'sendERC20',
    args: [
      token,
      amount,
      SCHEME_ID,
      stealth.stealthAddress,
      stealth.ephemeralPubKey,
      `0x${viewTagHex}` as HexString,
    ],
  });

  return {
    transaction: {
      to: deployment.contracts.sender,
      data: data as HexString,
      value: gasTip ? parseEther(gasTip) : undefined,
    },
    stealthAddress: stealth.stealthAddress,
    ephemeralPubKey: stealth.ephemeralPubKey,
    viewTag: stealth.viewTag,
  };
}

/**
 * Builds a transaction to register a .wraith name on-chain.
 * The name is bound to the spending key in the meta-address.
 */
export function buildRegisterName(params: {
  name: string;
  stealthKeys: StealthKeys;
  chain: string;
}): TransactionData {
  const { name, stealthKeys, chain } = params;
  const deployment = getDeployment(chain);
  const cleanName = name.replace(/\.wraith$/, '');
  const metaAddress = encodeStealthMetaAddress(
    stealthKeys.spendingPubKey,
    stealthKeys.viewingPubKey,
  );
  const metaBytes = metaAddressToBytes(metaAddress);
  const signature = signNameRegistration(cleanName, metaBytes, stealthKeys.spendingKey);

  const data = encodeFunctionData({
    abi: NAMES_ABI,
    functionName: 'register',
    args: [cleanName, metaBytes, signature],
  });

  return {
    to: deployment.contracts.names,
    data: data as HexString,
  };
}

/**
 * Builds a transaction to update a .wraith name's meta-address.
 * Must be signed by the current owner's spending key.
 */
export function buildUpdateName(params: {
  name: string;
  newStealthKeys: StealthKeys;
  currentSpendingKey: HexString;
  chain: string;
}): TransactionData {
  const { name, newStealthKeys, currentSpendingKey, chain } = params;
  const deployment = getDeployment(chain);
  const cleanName = name.replace(/\.wraith$/, '');
  const newMetaAddress = encodeStealthMetaAddress(
    newStealthKeys.spendingPubKey,
    newStealthKeys.viewingPubKey,
  );
  const newMetaBytes = metaAddressToBytes(newMetaAddress);
  const signature = signNameUpdate(cleanName, newMetaBytes, currentSpendingKey);

  const data = encodeFunctionData({
    abi: NAMES_ABI,
    functionName: 'update',
    args: [cleanName, newMetaBytes, signature],
  });

  return {
    to: deployment.contracts.names,
    data: data as HexString,
  };
}

/**
 * Builds a transaction to release a .wraith name.
 * After release, the name can be registered by anyone.
 */
export function buildReleaseName(params: {
  name: string;
  spendingKey: HexString;
  chain: string;
}): TransactionData {
  const { name, spendingKey, chain } = params;
  const deployment = getDeployment(chain);
  const cleanName = name.replace(/\.wraith$/, '');
  const signature = signNameRelease(cleanName, spendingKey);

  const data = encodeFunctionData({
    abi: NAMES_ABI,
    functionName: 'release',
    args: [cleanName, signature],
  });

  return {
    to: deployment.contracts.names,
    data: data as HexString,
  };
}

/**
 * Builds a transaction to register a stealth meta-address in the ERC-6538 registry.
 * This makes the meta-address discoverable by address.
 */
export function buildRegisterMetaAddress(params: {
  metaAddress: string;
  chain: string;
}): TransactionData {
  const { metaAddress, chain } = params;
  const deployment = getDeployment(chain);
  const metaBytes = metaAddressToBytes(metaAddress);

  const data = encodeFunctionData({
    abi: REGISTRY_ABI,
    functionName: 'registerKeys',
    args: [SCHEME_ID, metaBytes],
  });

  return {
    to: deployment.contracts.registry,
    data: data as HexString,
  };
}

/**
 * Builds a transaction to announce a stealth address on-chain.
 * Use this if you're sending assets directly (not via WraithSender)
 * and need to publish the announcement separately.
 */
export function buildAnnounce(params: {
  stealthAddress: HexString;
  ephemeralPubKey: HexString;
  viewTag: number;
  chain: string;
}): TransactionData {
  const { stealthAddress, ephemeralPubKey, viewTag, chain } = params;
  const deployment = getDeployment(chain);
  const viewTagHex = viewTag.toString(16).padStart(2, '0');

  const data = encodeFunctionData({
    abi: ANNOUNCER_ABI,
    functionName: 'announce',
    args: [SCHEME_ID, stealthAddress, ephemeralPubKey, `0x${viewTagHex}` as HexString],
  });

  return {
    to: deployment.contracts.announcer,
    data: data as HexString,
  };
}

/**
 * Builds a read call to resolve a .wraith name to its meta-address.
 * This returns calldata for a static call — no transaction needed.
 */
export function buildResolveName(params: { name: string; chain: string }): TransactionData {
  const { name, chain } = params;
  const deployment = getDeployment(chain);
  const cleanName = name.replace(/\.wraith$/, '');

  const data = encodeFunctionData({
    abi: NAMES_ABI,
    functionName: 'resolve',
    args: [cleanName],
  });

  return {
    to: deployment.contracts.names,
    data: data as HexString,
  };
}
