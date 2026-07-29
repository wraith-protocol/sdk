import { deriveStealthKeys, bytesToHex } from '@wraith-protocol/sdk/chains/stellar';
import { hexToBytes } from '../lib/hex';
import { setWallet } from '../lib/storage';
import type { ConnectedWallet } from '../lib/types';

/**
 * Derive stealth keys from a wallet signature and persist the viewing-side
 * material.
 *
 * The scanner only ever needs the viewing key + spending public key + spending
 * scalar to *detect* payments, so that is all we store. The raw signature is
 * used to derive keys and then discarded — it never touches storage.
 *
 * @param address    The connected Stellar public address (G...).
 * @param signature  64-byte ed25519 signature of the Wraith signing message.
 */
export async function connectWithSignature(
  address: string,
  signature: Uint8Array,
): Promise<ConnectedWallet> {
  if (signature.length !== 64) {
    throw new Error(`Expected a 64-byte signature, got ${signature.length} bytes.`);
  }
  const keys = deriveStealthKeys(signature);
  const wallet: ConnectedWallet = {
    address,
    viewingKeyHex: bytesToHex(keys.viewingKey),
    viewingPubKeyHex: bytesToHex(keys.viewingPubKey),
    spendingPubKeyHex: bytesToHex(keys.spendingPubKey),
    spendingScalar: keys.spendingScalar.toString(),
    connectedAt: Date.now(),
  };
  await setWallet(wallet);
  return wallet;
}

/** Parse a hex signature string (with or without 0x) into 64 bytes. */
export function parseSignatureHex(hex: string): Uint8Array {
  const bytes = hexToBytes(hex.trim());
  if (bytes.length !== 64) {
    throw new Error(`Signature must be 64 bytes (128 hex chars), got ${bytes.length}.`);
  }
  return bytes;
}
