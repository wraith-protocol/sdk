/**
 * Lightweight AES-256-GCM encrypt / decrypt wrappers backed by WebCrypto.
 *
 * All operations are in-memory; no plaintext touches persistent storage.
 *
 * @module vault/aes
 */

const AES_ALGORITHM = 'AES-GCM';
const AES_KEY_LENGTH = 256;

/**
 * Import a raw 32-byte key into a WebCrypto {@link CryptoKey}.
 *
 * @param rawKey - 32 bytes of key material.
 */
export async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  if (rawKey.byteLength !== 32) {
    throw new RangeError(`AES-256 key must be 32 bytes; got ${rawKey.byteLength}`);
  }

  return crypto.subtle.importKey('raw', rawKey as BufferSource, AES_ALGORITHM, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Encrypt `plaintext` with AES-256-GCM.
 *
 * A fresh 12-byte IV is generated for every call.
 *
 * @param key   - An AES-256-GCM CryptoKey.
 * @param plaintext - Arbitrary bytes to encrypt (e.g. seed material).
 * @returns The random IV and resulting ciphertext (which includes the GCM
 *          authentication tag).
 */
export async function aesEncrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: AES_ALGORITHM, iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  );
  return { iv, ciphertext: new Uint8Array(ct) };
}

/**
 * Decrypt `ciphertext` with AES-256-GCM.
 *
 * @param key        - An AES-256-GCM CryptoKey.
 * @param iv         - The 12-byte IV used during encryption.
 * @param ciphertext - The ciphertext + 16-byte authentication tag produced
 *                     by {@link aesEncrypt}.
 * @returns The original plaintext.
 * @throws If the authentication tag does not match (tampered or corrupt
 *         ciphertext).
 */
export async function aesDecrypt(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt(
    { name: AES_ALGORITHM, iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  return new Uint8Array(pt);
}
