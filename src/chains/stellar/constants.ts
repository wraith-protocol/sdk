/** Message signed by the user's wallet to derive stealth keys. */
export const STEALTH_SIGNING_MESSAGE =
  'Sign this message to generate your Wraith stealth keys.\n\nChain: Stellar\nNote: This signature is used for key derivation only and does not authorize any transaction.';

/** Scheme ID for ed25519-based stealth addresses on Stellar. */
export const SCHEME_ID = 1;

/** Prefix for stealth meta-addresses on Stellar. */
export const META_ADDRESS_PREFIX = 'st:xlm:';
