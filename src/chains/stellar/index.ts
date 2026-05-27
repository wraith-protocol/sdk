/**
 * @module @wraith-protocol/sdk/chains/stellar
 *
 * Stealth address cryptography for the Stellar network using ed25519 and X25519 ECDH.
 *
 * **Typical recipient flow:**
 * 1. Sign {@link STEALTH_SIGNING_MESSAGE} with your wallet → {@link deriveStealthKeys}
 * 2. Share your meta-address via {@link encodeStealthMetaAddress}
 * 3. Periodically call {@link fetchAnnouncements} + {@link scanAnnouncements} to detect payments
 * 4. Spend with {@link signStellarTransaction} using the matched scalar
 *
 * **Typical sender flow:**
 * 1. Obtain recipient's meta-address → {@link decodeStealthMetaAddress}
 * 2. {@link generateStealthAddress} → send XLM to the returned `stealthAddress`
 * 3. Publish `ephemeralPubKey` and `viewTag` on-chain via the announcer contract
 *
 * @see {@link https://wraith-protocol/docs} for full protocol documentation
 */

export { deriveStealthKeys } from './keys';
export { STEALTH_SIGNING_MESSAGE, SCHEME_ID, META_ADDRESS_PREFIX } from './constants';
export { encodeStealthMetaAddress, decodeStealthMetaAddress } from './meta-address';
export { generateStealthAddress, computeSharedSecret, computeViewTag } from './stealth';
export { checkStealthAddress, scanAnnouncements } from './scan';
export { deriveStealthPrivateScalar, signStellarTransaction } from './spend';
export {
  seedToScalar,
  hashToScalar,
  deriveStealthPubKey,
  pubKeyToStellarAddress,
  signWithScalar,
  L,
} from './scalar';
export { bytesToHex, hexToBytes } from './utils';
export { fetchAnnouncements } from './announcements';
export { DEPLOYMENTS, getDeployment } from './deployments';
export type { StellarChainDeployment } from './deployments';
export type {
  HexString,
  StealthKeys,
  StealthMetaAddress,
  GeneratedStealthAddress,
  Announcement,
  MatchedAnnouncement,
} from './types';
