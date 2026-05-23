/** Hex-encoded value with a `0x` prefix. */
export type HexString = `0x${string}`;

/**
 * Spending and viewing key material derived from a Stellar wallet signature.
 *
 * Keep the seed and scalar fields private. Public keys can be shared through a
 * stealth meta-address so senders can generate one-time receiving accounts.
 *
 * @see {@link deriveStealthKeys}
 */
export interface StealthKeys {
  /** 32-byte spending seed (ed25519). */
  spendingKey: Uint8Array;
  /** Clamped spending scalar derived via SHA-512 from the seed. */
  spendingScalar: bigint;
  /** 32-byte viewing seed (ed25519). */
  viewingKey: Uint8Array;
  /** Clamped viewing scalar derived via SHA-512 from the seed. */
  viewingScalar: bigint;
  /** 32-byte spending public key (ed25519). */
  spendingPubKey: Uint8Array;
  /** 32-byte viewing public key (ed25519). */
  viewingPubKey: Uint8Array;
}

/**
 * Parsed Stellar stealth meta-address components.
 *
 * The two public keys are safe to share and are enough for senders to generate
 * a stealth address, but not enough to scan or spend.
 *
 * @see {@link decodeStealthMetaAddress}
 */
export interface StealthMetaAddress {
  /** Stellar stealth meta-address prefix, currently `st:xlm:`. */
  prefix: string;
  /** 32-byte spending public key. */
  spendingPubKey: Uint8Array;
  /** 32-byte viewing public key. */
  viewingPubKey: Uint8Array;
}

/**
 * Result of generating a one-time Stellar stealth account for a recipient.
 *
 * The sender funds `stealthAddress` and publishes `ephemeralPubKey` plus the
 * view tag so the recipient can detect the payment while scanning.
 *
 * @see {@link generateStealthAddress}
 */
export interface GeneratedStealthAddress {
  /** The Stellar public key (G...) of the stealth address. */
  stealthAddress: string;
  /** 32-byte ephemeral public key (ed25519). */
  ephemeralPubKey: Uint8Array;
  /** The 1-byte view tag (0-255). */
  viewTag: number;
}

/**
 * Soroban event payload for a published Stellar stealth payment announcement.
 *
 * Announcements are public metadata. They reveal the generated stealth account
 * and sender/caller, but not which recipient can detect or spend the payment.
 *
 * @see {@link fetchAnnouncements}
 */
export interface Announcement {
  /** Scheme identifier (1 for ed25519). */
  schemeId: number;
  /** The Stellar public key (G...) of the stealth address. */
  stealthAddress: string;
  /** The Stellar public key of the sender/caller. */
  caller: string;
  /** 32-byte ephemeral public key (hex-encoded). */
  ephemeralPubKey: string;
  /** Hex-encoded metadata; the first byte is the view tag. */
  metadata: string;
}

/**
 * Announcement that matched the recipient's viewing key.
 *
 * Matched announcements include the derived private scalar needed to sign from
 * the stealth account. The viewing key alone can detect matches, but deriving
 * this result also requires the recipient's spending scalar.
 *
 * @see {@link scanAnnouncements}
 */
export interface MatchedAnnouncement extends Announcement {
  /** The stealth private scalar: (spending_scalar + hash_scalar) mod L. */
  stealthPrivateScalar: bigint;
  /** 32-byte stealth public key bytes used by the signing helpers. */
  stealthPubKeyBytes: Uint8Array;
}
