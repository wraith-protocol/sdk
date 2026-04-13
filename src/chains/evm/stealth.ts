import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak256, toHex, toBytes, getAddress } from "viem";
import type { HexString, GeneratedStealthAddress } from "./types";

/**
 * Generates a one-time stealth address for a recipient.
 *
 * Sender-side logic:
 *   r, R = r·G  →  S = r · K_view  →  s_h = keccak256(S)
 *   view tag = s_h[0]
 *   P_stealth = K_spend + G · (s_h mod n)
 *   address = last 20 bytes of keccak256(uncompressed P_stealth without 04 prefix)
 *
 * @param spendingPubKey  Recipient's 33-byte compressed spending public key.
 * @param viewingPubKey   Recipient's 33-byte compressed viewing public key.
 * @param ephemeralPrivateKey  Optional fixed ephemeral key for deterministic testing.
 */
export function generateStealthAddress(
  spendingPubKey: HexString,
  viewingPubKey: HexString,
  ephemeralPrivateKey?: HexString
): GeneratedStealthAddress {
  const ephPrivKey = ephemeralPrivateKey
    ? toBytes(ephemeralPrivateKey)
    : secp256k1.utils.randomPrivateKey();
  const ephPubKey = secp256k1.getPublicKey(ephPrivKey, true);

  const sharedSecret = secp256k1.getSharedSecret(
    ephPrivKey,
    toBytes(viewingPubKey),
    true
  );

  const hashedSecret = keccak256(toHex(sharedSecret));
  const hashedSecretBytes = toBytes(hashedSecret);

  const viewTag = hashedSecretBytes[0];

  const n = secp256k1.CURVE.n;
  let secretScalar = BigInt(hashedSecret) % n;
  if (secretScalar === 0n) {
    throw new Error("Hashed secret reduced to zero mod n");
  }

  const K_spend = secp256k1.ProjectivePoint.fromHex(toBytes(spendingPubKey));
  const sharedPoint = secp256k1.ProjectivePoint.BASE.multiply(secretScalar);
  const stealthPubKey = K_spend.add(sharedPoint);

  const uncompressed = stealthPubKey.toRawBytes(false);
  const pubKeyNoPrefix = uncompressed.slice(1);
  const addressHash = keccak256(toHex(pubKeyNoPrefix));
  const stealthAddress = getAddress(
    `0x${addressHash.slice(-40)}`
  ) as HexString;

  return {
    stealthAddress,
    ephemeralPubKey: toHex(ephPubKey) as HexString,
    viewTag,
  };
}
