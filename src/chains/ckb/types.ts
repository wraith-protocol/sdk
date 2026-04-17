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

/** Result of generating a stealth address for a CKB recipient. */
export interface GeneratedStealthAddress {
  /** 33-byte compressed stealth public key. */
  stealthPubKey: HexString;
  /** 20-byte blake160 hash of the stealth public key. */
  stealthPubKeyHash: HexString;
  /** 33-byte compressed ephemeral public key. */
  ephemeralPubKey: HexString;
  /** 53 bytes: ephemeral_pub (33) || blake160(stealth_pub) (20). */
  lockArgs: HexString;
}

/**
 * A CKB stealth cell. On CKB, the Cell itself IS the announcement.
 * The lock script args contain the ephemeral pubkey and stealth pubkey hash.
 */
export interface StealthCell {
  txHash: HexString;
  index: number;
  /** Capacity in shannons. */
  capacity: bigint;
  /** 53-byte lock args: ephemeral_pub || blake160(stealth_pub). */
  lockArgs: HexString;
  /** Extracted from lockArgs[0:33]. */
  ephemeralPubKey: HexString;
  /** Extracted from lockArgs[33:53]. */
  stealthPubKeyHash: HexString;
}

/** A stealth cell that matched the recipient's viewing key. */
export interface MatchedStealthCell extends StealthCell {
  stealthPrivateKey: HexString;
}
