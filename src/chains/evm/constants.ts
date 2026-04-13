/**
 * The fixed message users sign to derive their stealth keys.
 * RFC 6979 ensures the same wallet always produces the same signature for this message,
 * making the derived keys deterministic and recoverable.
 */
export const STEALTH_SIGNING_MESSAGE =
  "Sign this message to generate your Wraith stealth keys.\n\nChain: Horizen\nNote: This signature is used for key derivation only. It does not authorize any transaction.";

/** ERC-5564 scheme ID for secp256k1 with view tags. */
export const SCHEME_ID = 1n;

/** Stealth meta-address prefix per ERC-5564 / EIP-3770. */
export const META_ADDRESS_PREFIX = "st:eth:0x";
