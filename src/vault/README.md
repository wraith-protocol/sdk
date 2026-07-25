# Seed Vault — Threat Model & Design

The **SeedVault** encrypts a 32-byte stealth signing seed at rest in IndexedDB
and requires a WebAuthn touch (biometric / PIN) to decrypt it. It is not a
wallet and does not custody funds — its sole purpose is to remove the friction
of having to sign the `STEALTH_SIGNING_MESSAGE` every session while keeping the
derived seed off-disk in plaintext.

---

## What the vault protects

| Threat                             | Mitigation                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Plaintext seed on disk**         | The seed is encrypted with AES-256-GCM before it touches IndexedDB. The ciphertext is indistinguishable from random bytes.                                                                                   |
| **Passive disk forensics**         | Even if an attacker dumps the IndexedDB file and obtains the encrypted blob, they cannot decrypt it without the WebAuthn PRF key material, which never leaves the secure enclave / TPM of the authenticator. |
| **Unauthorised in-browser access** | The seed is held in a JavaScript `Uint8Array` in a private `Map`. There is no `localStorage`, `sessionStorage`, or `window` global leak.                                                                     |
| **Cross-tab unlocking**            | When one tab locks the vault, all tabs that share the same `BroadcastChannel` name receive a `lock` event and wipe their in-memory seeds immediately.                                                        |
| **Tab-close leakage**              | `pagehide` and `beforeunload` handlers clear the in-memory `Map` before the page unloads.                                                                                                                    |

---

## What the vault does **not** protect

| Threat                                   | Reason                                                                                                                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Compromised JavaScript context (XSS)** | If an attacker executes arbitrary JS in the same origin, they can call `vault.unlock()` and exfiltrate the seed (after the user touches their authenticator). This is an inherent limitation of _any_ browser-based secret store. |
| **Memory scraping**                      | The seed resides in unencrypted `Uint8Array` memory while the vault is unlocked. A sophisticated memory-corruption exploit or OS-level process dump could recover it.                                                             |
| **Authenticator compromise**             | If the user's platform authenticator (e.g. biometric sensor, PIN) is compromised, the attacker can perform WebAuthn assertions and decrypt the seed.                                                                              |
| **Phishing / social engineering**        | The user can be tricked into touching their authenticator on a malicious origin. The vault assumes the origin is trusted.                                                                                                         |
| **Backup & recovery**                    | The vault is a convenience layer. If the user's WebAuthn credential is deleted or the browser's IndexedDB is cleared, the seed is **irretrievable**. Users must back up their seed independently.                                 |
| **Multi-device sync**                    | The vault is local to one browser profile on one device. It does not sync across devices.                                                                                                                                         |

---

## Cryptographic design

```
┌──────────────────────────────────────────────────────────────────┐
│                        SEED VAULT CREATE                         │
│                                                                  │
│  1. Generate random 32-byte seed                                 │
│  2. Generate random 32-byte PRF salt                             │
│  3. WebAuthn create() with prf.eval.first = salt                 │
│     → Authenticator returns prf.results.first = PRF(seed, salt)  │
│     → Store credentialId                                         │
│  4. PRF output → AES-256-GCM key                                 │
│  5. Encrypt seed → { iv, ciphertext }                            │
│  6. Store in IDB: { credentialId, salt, iv, ciphertext }         │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                        SEED VAULT UNLOCK                         │
│                                                                  │
│  1. Read { credentialId, salt, iv, ciphertext } from IDB         │
│  2. WebAuthn get() with prf.eval.first = salt                    │
│     → Authenticator returns same PRF output                      │
│  3. PRF output → AES-256-GCM key                                 │
│  4. Decrypt → seed held in memory (JS Map)                       │
└──────────────────────────────────────────────────────────────────┘
```

- **PRF extension** (`prf`): defined in the WebAuthn Level 2 specification.
  The authenticator computes `HMAC-SHA256(credential_private_key, salt)`.
  The result is 32 bytes, suitable as AES-256 key material.
- **AES-256-GCM**: each encryption uses a fresh 12-byte random IV.
- **Salt uniqueness**: a random 32-byte salt is generated per vault entry.
  The same salt is presented to the authenticator on every unlock.
- **No PBKDF2**: the PRF output is used directly as the AES key (after
  validation). There is no need for key stretching because the PRF output
  already consumes the authenticator's private key.

---

## Data at rest (IndexedDB)

The `entries` object store in the `wraith-seed-vault` database contains:

| Field          | Type     | Description                                                      |
| -------------- | -------- | ---------------------------------------------------------------- |
| `label`        | `string` | Human-readable key (primary key).                                |
| `credentialId` | `string` | Base64url-encoded WebAuthn credential ID.                        |
| `salt`         | `string` | Base64-encoded 32-byte PRF salt.                                 |
| `iv`           | `string` | Base64-encoded 12-byte AES-GCM IV.                               |
| `ciphertext`   | `string` | Base64-encoded AES-256-GCM ciphertext (seed + 16-byte auth tag). |

The ciphertext reveals no plaintext information. Without the WebAuthn
authenticator and user presence, the entries are useless.

---

## Usage

```ts
import { SeedVault } from '@wraith-protocol/sdk/vault';

if (!SeedVault.isSupported()) {
  throw new Error('WebAuthn not available');
}

const vault = new SeedVault();

// First time: register a credential and store the seed.
const seed = await vault.create('my-stealth-seed');

// Derive stealth keys from the seed as usual…
// (After locking / tab-reload) — unlock again:
await vault.unlock('my-stealth-seed');
const seedAgain = vault.getSeed('my-stealth-seed');

// Clean up when done.
await vault.lock();
```

---

## Non-goals

- **Wallet / custody**: the vault does not broadcast transactions, sign
  anything, or hold assets.
- **Key manager**: it stores one 32-byte seed per label. It does not manage
  hierarchical key trees or BIP-39 mnemonics.
- **Multi-device sync**: there is no server component. Users must back up
  their seed if they want to migrate to a new device.
