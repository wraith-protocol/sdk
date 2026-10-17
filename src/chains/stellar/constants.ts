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
 * Scheme identifier of the v1 Stellar announcement layout.
 *
 * @deprecated The name reads like the scheme the SDK emits, but it is the v1 value. Use
 * {@link SCHEME_ID_V1} for the legacy layout, or {@link ACTIVE_SCHEME_ID} for the scheme the
 * announcement builders emit.
 *
 * @see {@link scanAnnouncements}
 */
export const SCHEME_ID = 1;

/**
 * Scheme id of the v1 Stellar announcement layout. The v1 announcer emits
 * `("announce", scheme_id, stealth_address)` topics and accepts any scheme id.
 */
export const SCHEME_ID_V1 = 1;

/**
 * Scheme id of the v2 announcer, which emits indexed view-tag bucket topics and accepts only
 * this value.
 */
export const SCHEME_ID_V2 = 2;

/**
 * Scheme id the Stellar announcement builders emit, and the single source of truth for it:
 * `buildStealthAnnouncement()`, `buildPathStealthPayment()`, `buildStellarSwapAndStealth()`,
 * `buildAnnouncementData()` and `encodeAnnouncementData()` all read it.
 *
 * It is {@link SCHEME_ID_V2}, the only value the deployed v2 announcer accepts
 * (`STELLAR_V2_SCHEME_ID` in wraith-protocol/contracts). The legacy v1 announcer accepts any
 * scheme id, so the same calls also work against a v1 deployment. The scanners accept both
 * {@link SCHEME_ID_V1} and {@link SCHEME_ID_V2}.
 */
export const ACTIVE_SCHEME_ID = SCHEME_ID_V2;

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
