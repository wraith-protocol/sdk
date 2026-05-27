/**
 * The deterministic message users sign to derive their Wraith stealth keys on Stellar.
 *
 * This exact string is passed to a Stellar wallet's `signMessage` (or equivalent) call.
 * The resulting 64-byte ed25519 signature is fed into `deriveStealthKeys`.
 *
 * ⚠️  Do not alter this string without a migration plan — changing it produces completely
 * different keys for every existing user.
 *
 * @example
 * ```ts
 * import { STEALTH_SIGNING_MESSAGE, deriveStealthKeys } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const signatureBytes = await wallet.signMessage(STEALTH_SIGNING_MESSAGE);
 * const keys = deriveStealthKeys(signatureBytes);
 * ```
 *
 * @see {@link deriveStealthKeys} for converting the signature into usable key pairs
 */
export const STEALTH_SIGNING_MESSAGE =
  'Sign this message to generate your Wraith stealth keys.\n\nChain: Stellar\nNote: This signature is used for key derivation only and does not authorize any transaction.';

/**
 * Scheme identifier for ed25519-based stealth addresses on Stellar (value: `1`).
 *
 * Stored in every on-chain announcement so that scanners can quickly skip
 * announcements from incompatible schemes without inspecting the full payload.
 *
 * @see {@link scanAnnouncements} which filters on this value
 */
export const SCHEME_ID = 1;

/**
 * URL-safe prefix that every Stellar stealth meta-address begins with (`"st:xlm:"`).
 *
 * The full meta-address format is:
 * ```
 * st:xlm:<spending_pubkey_hex_64_chars><viewing_pubkey_hex_64_chars>
 * ```
 *
 * @see {@link encodeStealthMetaAddress} to produce a meta-address
 * @see {@link decodeStealthMetaAddress} to parse one
 */
export const META_ADDRESS_PREFIX = 'st:xlm:';