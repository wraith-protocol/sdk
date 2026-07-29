# Stellar stealth signers

## Background

`deriveStealthKeys(signature)` derives Stellar stealth spending/viewing keys from a raw
64-byte ed25519 signature, which assumes a Freighter-shaped wallet that can synchronously
produce that signature. A WebAuthn passkey (secp256r1, via a Stellar smart account) can't
satisfy that shape: assertions are asynchronous, are not ed25519, and are not deterministic
across sessions (ECDSA uses a fresh nonce, and the authenticator's signature counter and
`clientDataJSON` challenge change on every call).

`StellarStealthSigner` decouples key derivation from the signing mechanism so any wallet,
including a passkey-only one, can derive stealth keys as long as it can produce 64
deterministic bytes for a fixed message.

## API

### `StellarStealthSigner`

```ts
interface StellarStealthSigner {
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}
```

`signMessage` doesn't need to return a real signature — only 64 bytes that are reproducible
for the same wallet and message across separate calls, including separate sessions and
devices for the same underlying wallet.

### `deriveStealthKeysFromSigner`

```ts
import { deriveStealthKeysFromSigner } from '@wraith-protocol/sdk/chains/stellar';

const keys = await deriveStealthKeysFromSigner(signer);
```

Signs `STEALTH_SIGNING_MESSAGE` with `signer` and feeds the result into `deriveStealthKeys`.
Existing code that already holds a raw Freighter signature can keep calling
`deriveStealthKeys(signature)` directly — this path is unchanged.

### `FreighterStealthSigner`

```ts
import { FreighterStealthSigner } from '@wraith-protocol/sdk/chains/stellar';

const signer = new FreighterStealthSigner(freighterApi); // { signMessage(message): Promise<{ signedMessage }> }
const keys = await deriveStealthKeysFromSigner(signer);
```

Wraps a Freighter-shaped wallet and passes its ed25519 signature straight through, matching
the existing derivation exactly.

### `WebAuthnPasskeyStealthSigner`

```ts
import { WebAuthnPasskeyStealthSigner } from '@wraith-protocol/sdk/chains/stellar';

const signer = new WebAuthnPasskeyStealthSigner({
  credentialId, // the passkey's credential ID
  rpId: 'wraith.dev',
  // credentials defaults to navigator.credentials in a browser
});

const keys = await deriveStealthKeysFromSigner(signer);
```

Reference adapter for a passkey-backed smart account. Instead of hashing the (non-deterministic)
assertion signature, it requests the WebAuthn Level 3 `prf` extension with two fixed salts.
PRF output is deterministically derived from the credential's private key material and the
salt, so the same passkey produces the same 64 bytes on every device and session, without
ever exposing the underlying secret. Concatenating the two 32-byte PRF outputs gives the
64 bytes `deriveStealthKeys` expects.

This adapter only covers stealth-key derivation. Authorizing the on-chain smart-account
operation that funds or spends a stealth address is a separate WebAuthn `get()` call
(without the `prf` extension); that assertion doesn't need to be deterministic and is
submitted directly to the smart-account contract.

If the authenticator doesn't support `prf`, `signMessage` throws `KeyDerivationFailedError`.

### `useStellarStealthKeys` (sdk-react)

```ts
const { keys, generate, generateFromSigner } = useStellarStealthKeys();

// existing Freighter path, unchanged
generate(rawSignature);

// signer-based path (Freighter wrapper, passkey adapter, or a custom signer)
await generateFromSigner(signer);
```
