import { describe, test, expect } from "vitest";
import { deriveStealthKeys } from "../../../src/chains/evm/keys";
import type { HexString } from "../../../src/chains/evm/types";

const testSig = ("0x" + "aa".repeat(32) + "bb".repeat(32) + "1b") as HexString;

describe("deriveStealthKeys", () => {
  test("derives valid keys from signature", () => {
    const keys = deriveStealthKeys(testSig);

    expect(keys.spendingKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(keys.viewingKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(keys.spendingPubKey).toMatch(/^0x(02|03)[0-9a-f]{64}$/);
    expect(keys.viewingPubKey).toMatch(/^0x(02|03)[0-9a-f]{64}$/);
  });

  test("deterministic derivation", () => {
    const keys1 = deriveStealthKeys(testSig);
    const keys2 = deriveStealthKeys(testSig);

    expect(keys1.spendingKey).toBe(keys2.spendingKey);
    expect(keys1.viewingKey).toBe(keys2.viewingKey);
    expect(keys1.spendingPubKey).toBe(keys2.spendingPubKey);
    expect(keys1.viewingPubKey).toBe(keys2.viewingPubKey);
  });

  test("spending key differs from viewing key", () => {
    const keys = deriveStealthKeys(testSig);
    expect(keys.spendingKey).not.toBe(keys.viewingKey);
  });

  test("rejects wrong signature length (64 bytes)", () => {
    const short = ("0x" + "aa".repeat(64)) as HexString;
    expect(() => deriveStealthKeys(short)).toThrow("Expected 65-byte signature");
  });

  test("rejects wrong signature length (66 bytes)", () => {
    const long = ("0x" + "aa".repeat(66)) as HexString;
    expect(() => deriveStealthKeys(long)).toThrow("Expected 65-byte signature");
  });
});
