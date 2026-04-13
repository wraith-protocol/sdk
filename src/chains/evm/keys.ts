import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak256, toHex, toBytes } from "viem";
import type { HexString, StealthKeys } from "./types";

/**
 * Derives stealth spending and viewing keys from a wallet signature.
 *
 * The 65-byte signature (r ‖ s ‖ v) is split:
 *   - spendingKey = keccak256(r)  (first 32 bytes)
 *   - viewingKey  = keccak256(s)  (bytes 32–63)
 *
 * Both keys are validated as non-zero scalars less than the secp256k1 curve order.
 */
export function deriveStealthKeys(signature: HexString): StealthKeys {
  const sigBytes = toBytes(signature);

  if (sigBytes.length !== 65) {
    throw new Error(
      `Expected 65-byte signature, got ${sigBytes.length} bytes`
    );
  }

  const r = sigBytes.slice(0, 32);
  const s = sigBytes.slice(32, 64);

  const spendingKey = keccak256(toHex(r));
  const viewingKey = keccak256(toHex(s));

  const spendingScalar = BigInt(spendingKey);
  const viewingScalar = BigInt(viewingKey);
  const n = secp256k1.CURVE.n;

  if (spendingScalar === 0n || spendingScalar >= n) {
    throw new Error("Derived spending key is not a valid secp256k1 scalar");
  }
  if (viewingScalar === 0n || viewingScalar >= n) {
    throw new Error("Derived viewing key is not a valid secp256k1 scalar");
  }

  const spendingPubKey = toHex(
    secp256k1.getPublicKey(toBytes(spendingKey), true)
  ) as HexString;
  const viewingPubKey = toHex(
    secp256k1.getPublicKey(toBytes(viewingKey), true)
  ) as HexString;

  return { spendingKey, viewingKey, spendingPubKey, viewingPubKey };
}
