import { describe, test, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519";
import { deriveStealthKeys } from "../../../src/chains/stellar/keys";
import { generateStealthAddress } from "../../../src/chains/stellar/stealth";
import { scanAnnouncements } from "../../../src/chains/stellar/scan";
import { deriveStealthPrivateScalar } from "../../../src/chains/stellar/spend";
import { encodeStealthMetaAddress, decodeStealthMetaAddress } from "../../../src/chains/stellar/meta-address";
import { SCHEME_ID } from "../../../src/chains/stellar/constants";
import { bytesToHex } from "../../../src/chains/stellar/utils";
import type { Announcement } from "../../../src/chains/stellar/types";

const testSig = new Uint8Array(64).fill(0xaa);
const fixedSeed = new Uint8Array(32).fill(0xcc);

describe("e2e: full stealth payment flow on Stellar", () => {
  test("derive → generate → scan → spend → verify", () => {
    const keys = deriveStealthKeys(testSig);

    const meta = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
    expect(meta).toMatch(/^st:xlm:/);

    const decoded = decodeStealthMetaAddress(meta);

    const stealth = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey, fixedSeed);
    expect(stealth.stealthAddress).toMatch(/^G[A-Z2-7]{55}$/);

    const announcement: Announcement = {
      schemeId: SCHEME_ID,
      stealthAddress: stealth.stealthAddress,
      caller: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
      metadata: stealth.viewTag.toString(16).padStart(2, "0"),
    };

    const matched = scanAnnouncements(
      [announcement],
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingScalar
    );
    expect(matched).toHaveLength(1);

    const stealthPub = ed25519.ExtendedPoint.BASE.multiply(matched[0].stealthPrivateScalar);
    expect(bytesToHex(stealthPub.toRawBytes())).toBe(bytesToHex(matched[0].stealthPubKeyBytes));

    const independentScalar = deriveStealthPrivateScalar(
      keys.spendingScalar,
      keys.viewingKey,
      stealth.ephemeralPubKey
    );
    expect(independentScalar).toBe(matched[0].stealthPrivateScalar);
  });
});
