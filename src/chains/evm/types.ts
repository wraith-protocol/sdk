export type HexString = `0x${string}`;

/** Spending and viewing key pairs derived from a wallet signature. */
export interface StealthKeys {
  /** 32-byte spending private key. */
  spendingKey: HexString;
  /** 32-byte viewing private key. */
  viewingKey: HexString;
  /** 33-byte compressed spending public key. */
  spendingPubKey: HexString;
  /** 33-byte compressed viewing public key. */
  viewingPubKey: HexString;
}

/** Parsed stealth meta-address components. */
export interface StealthMetaAddress {
  prefix: string;
  spendingPubKey: HexString;
  viewingPubKey: HexString;
}

/** Result of generating a one-time stealth address for a recipient. */
export interface GeneratedStealthAddress {
  /** The 20-byte stealth address. */
  stealthAddress: HexString;
  /** The 33-byte compressed ephemeral public key. */
  ephemeralPubKey: HexString;
  /** The 1-byte view tag (0–255). */
  viewTag: number;
}

/** A raw on-chain announcement from the ERC-5564 Announcer contract. */
export interface Announcement {
  schemeId: bigint;
  stealthAddress: HexString;
  caller: HexString;
  ephemeralPubKey: HexString;
  metadata: HexString;
}

/** An announcement that matched the recipient's viewing key, with the derived spending key. */
export interface MatchedAnnouncement extends Announcement {
  stealthPrivateKey: HexString;
}
