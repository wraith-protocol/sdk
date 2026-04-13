import { describe, test, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { deriveStealthKeys } from "../../../src/chains/evm/keys";
import { generateStealthAddress } from "../../../src/chains/evm/stealth";
import { deriveStealthPrivateKey } from "../../../src/chains/evm/spend";
import type { HexString } from "../../../src/chains/evm/types";

const testSig = ("0x" + "aa".repeat(32) + "bb".repeat(32) + "1b") as HexString;
const fixedEphKey = ("0x" + "cc".repeat(32)) as HexString;

describe("deriveStealthPrivateKey", () => {
  test("returns valid 32-byte hex", () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedEphKey);
    const privKey = deriveStealthPrivateKey(keys.spendingKey, stealth.ephemeralPubKey, keys.viewingKey);

    expect(privKey).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("derived key controls the stealth address", () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedEphKey);
    const privKey = deriveStealthPrivateKey(keys.spendingKey, stealth.ephemeralPubKey, keys.viewingKey);
    const account = privateKeyToAccount(privKey);

    expect(account.address.toLowerCase()).toBe(stealth.stealthAddress.toLowerCase());
  });

  test("deterministic", () => {
    const keys = deriveStealthKeys(testSig);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedEphKey);
    const key1 = deriveStealthPrivateKey(keys.spendingKey, stealth.ephemeralPubKey, keys.viewingKey);
    const key2 = deriveStealthPrivateKey(keys.spendingKey, stealth.ephemeralPubKey, keys.viewingKey);

    expect(key1).toBe(key2);
  });
});
