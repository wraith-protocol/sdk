/**
 * Deterministic message users sign to derive Stellar stealth keys.
 *
 * Changing this value would derive a different spending and viewing key pair
 * for every wallet, so treat it as protocol-level data that needs a migration
 * plan before any update.
 *
 * @see {@link deriveStealthKeys}
 */
export const STEALTH_SIGNING_MESSAGE =
  'Sign this message to generate your Wraith stealth keys.\n\nChain: Stellar\nNote: This signature is used for key derivation only and does not authorize any transaction.';

/**
 * Scheme identifier used by Stellar announcements for ed25519 stealth addresses (v1 layout).
 *
 * Announcements with another scheme id are ignored by the Stellar scanner unless they
 * use {@link SCHEME_ID_V2}.
 *
 * @see {@link scanAnnouncements}
 */
export const SCHEME_ID = 1;

/** Alias for {@link SCHEME_ID} — v1 announcer event schema. */
export const SCHEME_ID_V1 = SCHEME_ID;

/** Scheme ID for the v2 announcer with indexed view-tag bucket topics. */
export const SCHEME_ID_V2 = 2;

/** Soroban event topic-0 symbol for stealth announcements. */
export const ANNOUNCE_EVENT_SYMBOL = 'announce';

/** Number of view-tag buckets exposed as Soroban RPC topic filters (0–255). */
export const VIEW_TAG_BUCKET_COUNT = 256;

/**
 * Prefix that identifies Wraith Stellar stealth meta-addresses.
 *
 * The payload after this prefix is the hex-encoded spending public key followed
 * by the hex-encoded viewing public key.
 *
 * @see {@link encodeStealthMetaAddress}
 */
export const META_ADDRESS_PREFIX = 'st:xlm:';
