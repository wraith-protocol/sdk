/** A hex-encoded string with a mandatory `0x` prefix. */
export type HexString = `0x${string}`;

/**
 * Spending and viewing key pairs derived deterministically from a wallet signature.
 *
 * Obtain this via {@link deriveStealthKeys}. Treat `spendingKey` and `spendingScalar`
 * as private key material — they control funds. The `viewingKey` / `viewingScalar`
 * are less sensitive (they only reveal *which* payments belong to you, not how to spend
 * them), but should still be kept private to preserve payment privacy.
 */
export interface StealthKeys {
  /** 32-byte ed25519 spending seed. Used as input to `seedToScalar` and public key derivation. */
  spendingKey: Uint8Array;
  /**
   * Clamped ed25519 scalar derived from `spendingKey` via SHA-512.
   * This is the actual private scalar used in stealth address math — not the raw seed.
   */
  spendingScalar: bigint;
  /** 32-byte ed25519 viewing seed. Less sensitive than the spending key, but still private. */
  viewingKey: Uint8Array;
  /**
   * Clamped ed25519 scalar derived from `viewingKey` via SHA-512.
   * Used in ECDH shared-secret computation during scanning.
   */
  viewingScalar: bigint;
  /** 32-byte compressed ed25519 spending public key. Safe to share publicly via a meta-address. */
  spendingPubKey: Uint8Array;
  /** 32-byte compressed ed25519 viewing public key. Safe to share publicly via a meta-address. */
  viewingPubKey: Uint8Array;
}

/**
 * Parsed components of a Stellar stealth meta-address.
 *
 * A meta-address is the public identifier a recipient shares so senders can
 * generate one-time stealth addresses for them. Obtain via
 * {@link decodeStealthMetaAddress}.
 */
export interface StealthMetaAddress {
  /** The `"st:xlm:"` prefix identifying this as a Stellar stealth meta-address. */
  prefix: string;
  /** 32-byte ed25519 spending public key extracted from the meta-address. */
  spendingPubKey: Uint8Array;
  /** 32-byte ed25519 viewing public key extracted from the meta-address. */
  viewingPubKey: Uint8Array;
}

/**
 * Result of generating a one-time stealth address for a recipient.
 *
 * The sender publishes `ephemeralPubKey` and `viewTag` on-chain (via the announcer
 * contract) so the recipient can scan for their payments.
 *
 * @see {@link generateStealthAddress} to produce this
 * @see {@link scanAnnouncements} for the recipient-side scan
 */
export interface GeneratedStealthAddress {
  /** The Stellar public key (G... Strkey) of the one-time stealth address. */
  stealthAddress: string;
  /**
   * 32-byte ephemeral ed25519 public key chosen by the sender.
   * Must be included in the on-chain announcement so the recipient can recompute the
   * shared secret.
   */
  ephemeralPubKey: Uint8Array;
  /**
   * Single-byte view tag (0–255) derived from the shared secret.
   * Allows the recipient to skip ~255 out of 256 announcements without computing the
   * full ECDH — a significant performance optimisation when scanning large ledger ranges.
   */
  viewTag: number;
}

/**
 * A raw stealth payment announcement as emitted by the Stellar announcer contract.
 *
 * Announcements are fetched from the Soroban event log via {@link fetchAnnouncements}
 * and fed into {@link scanAnnouncements}.
 */
export interface Announcement {
  /**
   * Scheme identifier — must equal {@link SCHEME_ID} (`1`) for this SDK to process the
   * announcement. Allows future scheme upgrades without breaking existing scanners.
   */
  schemeId: number;
  /** The Stellar public key (G... Strkey) of the stealth address the sender funded. */
  stealthAddress: string;
  /** The Stellar public key of the account that submitted the announcement transaction. */
  caller: string;
  /** 32-byte ephemeral public key, hex-encoded (no `0x` prefix). */
  ephemeralPubKey: string;
  /**
   * Hex-encoded metadata blob. The first byte is always the view tag; additional bytes
   * are reserved for future use.
   */
  metadata: string;
}

/**
 * An {@link Announcement} that matched the recipient's viewing key, enriched with the
 * data needed to spend the funds.
 *
 * Produced by {@link scanAnnouncements}. Deriving `stealthPrivateScalar` requires
 * `spendingScalar` — the viewing key alone can detect matches but cannot spend.
 */
export interface MatchedAnnouncement extends Announcement {
  /**
   * The stealth private scalar: `(spending_scalar + hash_scalar) mod L`.
   * Pass this to {@link signStellarTransaction} (along with `stealthPubKeyBytes`) to
   * sign transactions from the stealth address.
   */
  stealthPrivateScalar: bigint;
  /**
   * 32-byte compressed ed25519 public key of the stealth address.
   * Required as a co-input to {@link signStellarTransaction}.
   */
  stealthPubKeyBytes: Uint8Array;
}