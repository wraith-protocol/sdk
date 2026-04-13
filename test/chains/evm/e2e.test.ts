import { describe, test, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { deriveStealthKeys } from "../../../src/chains/evm/keys";
import { generateStealthAddress } from "../../../src/chains/evm/stealth";
import { scanAnnouncements } from "../../../src/chains/evm/scan";
import { deriveStealthPrivateKey } from "../../../src/chains/evm/spend";
import { encodeStealthMetaAddress, decodeStealthMetaAddress } from "../../../src/chains/evm/meta-address";
import { SCHEME_ID } from "../../../src/chains/evm/constants";
import type { HexString, Announcement } from "../../../src/chains/evm/types";

const testSig = ("0x" + "aa".repeat(32) + "bb".repeat(32) + "1b") as HexString;

describe("e2e: full stealth payment flow", () => {
  test("derive → generate → scan → spend → verify", () => {
    const keys = deriveStealthKeys(testSig);

    const meta = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
    expect(meta).toMatch(/^st:eth:0x/);

    const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(meta);

    const stealth = generateStealthAddress(spendingPubKey, viewingPubKey);

    const announcement: Announcement = {
      schemeId: SCHEME_ID,
      stealthAddress: stealth.stealthAddress,
      caller: ("0x" + "aa".repeat(20)) as HexString,
      ephemeralPubKey: stealth.ephemeralPubKey,
      metadata: ("0x" + stealth.viewTag.toString(16).padStart(2, "0")) as HexString,
    };

    const matched = scanAnnouncements([announcement], keys.viewingKey, keys.spendingPubKey, keys.spendingKey);
    expect(matched).toHaveLength(1);

    const account = privateKeyToAccount(matched[0].stealthPrivateKey);
    expect(account.address.toLowerCase()).toBe(stealth.stealthAddress.toLowerCase());

    const independentKey = deriveStealthPrivateKey(keys.spendingKey, stealth.ephemeralPubKey, keys.viewingKey);
    expect(independentKey).toBe(matched[0].stealthPrivateKey);
  });
});
