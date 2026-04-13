import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak256, toHex, toBytes } from "viem";
import type { HexString } from "./types";

/**
 * Derives the private key that controls a stealth address.
 *
 * Recipient-side logic:
 *   S = v · R  →  s_h = keccak256(S)  →  p_stealth = (m + s_h) mod n
 *
 * @param spendingKey     Recipient's 32-byte spending private key.
 * @param ephemeralPubKey The 33-byte compressed ephemeral public key from the announcement.
 * @param viewingKey      Recipient's 32-byte viewing private key.
 * @returns The 32-byte private key for the stealth address.
 */
export function deriveStealthPrivateKey(
  spendingKey: HexString,
  ephemeralPubKey: HexString,
  viewingKey: HexString
): HexString {
  const sharedSecret = secp256k1.getSharedSecret(
    toBytes(viewingKey),
    toBytes(ephemeralPubKey),
    true
  );

  const hashedSecret = keccak256(toHex(sharedSecret));

  const n = secp256k1.CURVE.n;
  const m = BigInt(spendingKey);
  const s_h = BigInt(hashedSecret) % n;
  const stealthPrivKey = (m + s_h) % n;

  const hex = stealthPrivKey.toString(16).padStart(64, "0");
  return `0x${hex}` as HexString;
}
