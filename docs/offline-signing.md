# Offline (Cold) Signing for Stellar Stealth Payments

## Why Offline Signing

When a Stellar secret key has ever touched a network-connected machine, it has been exposed to:

- Clipboard malware that monitors wallet address patterns
- Browser extensions with transaction-reading permissions
- Debugger probes that dump process memory
- Supply-chain compromised npm packages that scan for secret strings
- Disk persistence in unencrypted terminal history, editor swap files, or crashed-process core dumps

Cold signing — also called _air-gapped_ or _offline signing_ — keeps the secret key on a machine that has never been and will never be connected to a network. The signing machine receives unsigned transaction envelopes (via USB drive, QR code, or serial cable), produces signatures, and returns the signed output. The secret never enters the online environment.

For stealth payment workflows this matters especially because derived stealth keys still originate from a master wallet secret. If an attacker steals the master signature or the derived stealth scalar during generation, they can drain every stealth account associated with that wallet. Cold signing prevents that by keeping scalars off networked machines altogether.

## Overview

The offline signing module provides three functions that split the lifecycle into separate concerns so signing can happen on a disconnected machine:

| Environment             | Function                           | Responsibility                                                  |
| ----------------------- | ---------------------------------- | --------------------------------------------------------------- |
| **Online** (watcher)    | `prepareOfflineStellarTransaction` | Build the unsigned envelope with operations, sequence, and fee  |
| **Air-gapped** (signer) | `signOfflineStellarTransaction`    | Import the envelope, apply the signature, export the signed XDR |
| **Online** (submitter)  | `submitOfflineStellarTransaction`  | POST the signed envelope to Horizon                             |

## Step-by-Step Workflow

### 1. Build the unsigned envelope (online machine)

```ts
import { Keypair, Operation, Asset } from '@stellar/stellar-sdk';
import { prepareOfflineStellarTransaction } from '@wraith-protocol/sdk/chains/stellar';

const envelope = prepareOfflineStellarTransaction({
  source: 'GAS4V4OAP5L6J3J4X7Q5VX4Y5H5J5X5S5X5X5X5X5X5X5X5X5X5X5X5X',
  ops: [
    Operation.payment({
      destination: 'GC3J4X7Q5VX4Y5H5J5X5S5X5X5X5X5X5X5X5X5X5X5X5X5X5X5',
      asset: Asset.native(),
      amount: '100.5000000',
    }),
  ],
  sequence: '123456789',
  networkPassphrase: 'Test SDF Network ; September 2015',
  fee: '200',
  timeout: 300,
});
```

The returned `OfflineStellarEnvelope` contains three fields, all serializable to plain JSON:

```ts
console.log(envelope);
// {
//   transactionXdr: 'AAAAAgAAAACc...',   // base64 XDR — the unsigned envelope
//   networkPassphrase: 'Test SDF Network ; September 2015',  // needed for hash
//   hash: 'a1b2c3d4e5f6...',             // hex SHA-256 of the signing payload
// }
```

Transfer this object to the air-gapped machine — by JSON file on a USB stick, a QR code on a dedicated display, or a serial cable. Neither the secret key nor any derived scalar is present in the envelope, so the transfer channel does not need to be encrypted.

### 2. Sign the envelope (air-gapped machine)

```ts
import { signOfflineStellarTransaction } from '@wraith-protocol/sdk/chains/stellar';

// Load the envelope from USB / serial / QR scan
const envelope: OfflineStellarEnvelope = JSON.parse(
  fs.readFileSync('/mnt/usb/envelope.json', 'utf-8'),
);

const signedXdr = signOfflineStellarTransaction(
  envelope,
  'SAZSP4V4OAP5L6J3J4X7Q5VX4Y5H5J5X5S5X5X5X5X5X5X5X5X5X5X5X5X',
);

// The signed XDR is a base64 string containing the original transaction
// plus one DecoratedSignature in the envelope's signatures list
console.log(signedXdr);
// 'AAAAAgAAAACc...AAAAAAAAAAI...'
```

Transfer `signedXdr` back to the online machine. The signing machine's secret key never leaves it.

### 3. Submit to Horizon (online machine)

```ts
import { submitOfflineStellarTransaction } from '@wraith-protocol/sdk/chains/stellar';

const result = await submitOfflineStellarTransaction(signedXdr);
console.log('Transaction hash:', result.hash);
console.log('Ledger:', result.ledger);
```

The function resolves the Horizon URL from the chain deployment config (`getDeployment('stellar')`) and POSTs the XDR to `/transactions`. On failure it throws an `RPCRequestError` with the Horizon response body.

## Stealth Address Compatibility

Offline signing works with stealth-derived keys. The critical detail is that a stealth private scalar — produced by `deriveStealthPrivateScalar` — is a `bigint`, not a Stellar secret key string (`S...`). The signing function accepts both, but for stealth scalars you must also provide the corresponding ed25519 public key bytes so the correct signature hint can be embedded in the envelope.

```ts
import { Keypair, Operation, Asset, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  prepareOfflineStellarTransaction,
  signOfflineStellarTransaction,
} from '@wraith-protocol/sdk/chains/stellar';
import { deriveStealthKeys } from '@wraith-protocol/sdk/chains/stellar';
import { generateStealthAddress } from '@wraith-protocol/sdk/chains/stellar';
import { deriveStealthPrivateScalar } from '@wraith-protocol/sdk/chains/stellar';

// --- Online: prepare the envelope ---

// Sender knows the recipient's stealth meta-address
const recipientKeys = decodeStealthMetaAddress('st:xlm:a1b2c3...');

// Generate a one-time stealth address
const stealthResult = generateStealthAddress(
  recipientKeys.spendingPubKey,
  recipientKeys.viewingPubKey,
);

const envelope = prepareOfflineStellarTransaction({
  source: senderPk,
  ops: [
    Operation.payment({
      destination: stealthResult.stealthAddress,
      asset: Asset.native(),
      amount: '100',
    }),
  ],
  sequence: '123456789',
  networkPassphrase: 'Test SDF Network ; September 2015',
});

// Transfer envelope + stealthResult.ephemeralPubKey to the offline machine

// --- Offline: sign with the stealth scalar ---

// Derive keys from the master wallet signature (64-byte ed25519)
const masterSig = new Uint8Array(64); // from wallet.sign(STEALTH_SIGNING_MESSAGE)
const stealthKeys = deriveStealthKeys(masterSig);

// Derive the stealth private scalar for this specific announcement
const stealthScalar = deriveStealthPrivateScalar(
  stealthKeys.spendingScalar,
  stealthKeys.viewingKey,
  ephemeralPubKey, // from stealthResult, transferred from online machine
);

const signedXdr = signOfflineStellarTransaction(
  envelope,
  stealthScalar,
  stealthKeys.spendingPubKey, // ← required for the stealth scalar code path
);

// --- Online: submit ---

const result = await submitOfflineStellarTransaction(signedXdr);
```

The `stealthPubKey` parameter is used to construct the signature hint in the Stellar envelope. Without it the network cannot map the signature back to the signer's account. The spending public key is safe to transfer alongside the envelope — it is already public in the stealth meta-address.

### Verifying a stealth-signed envelope

```ts
const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
// The envelope carries one stealth signature inside
expect(tx.signatures.length).toBe(1);
// The source account matches the stealth address
expect(tx.source).toBe(stealthResult.stealthAddress);
```

## Security Best Practices

### Offline machine hygiene

- **Never connect the signing machine to any network** — no Ethernet, no Wi-Fi, no Bluetooth. Physically disable adapters if possible.
- **Boot from a read-only medium** (a live USB or a Linux distro with a squashfs root). A read-only OS prevents persistent malware from surviving a reboot.
- **Use a dedicated minimal OS** — one that ships zero network drivers (e.g., Tails without networking enabled, or a custom Alpine build).
- **Wipe RAM after every signing session** — a full shutdown (not suspend) clears DRAM. Cold boot attacks can recover secrets from memory for several minutes after power-off.

### Transfer channel

- **Single-use USB drives** — format after every session. Do not reuse the same USB stick across production signing operations.
- **QR codes on a dedicated display** — signers that output to an e-ink screen eliminate electromagnetic side-channel leakage from HDMI.
- **Serial cable (TTL UART)** — point-to-point with no protocol stack above the wire. There is no IP layer to attack.
- Never transfer the master secret key — only send unsigned envelopes to the signing machine and only receive signed XDRs back.

### Key usage

- **Generate master keys on the offline machine** — if that is not possible, derive them in a one-time ceremony where the signing message signature is immediately consumed and discarded.
- **Use separate keypairs for stealth vs. non-stealth operations** — derive a dedicated Stellar keypair for stealth workflows so that a non-stealth transaction signed with the same key does not reveal the master secret derivation path.
- **Preferred: use a hardware wallet** — the functions in this module accept both raw secret keys and `bigint` stealth scalars. For production cold storage, prefer a hardware wallet that can sign the transaction envelope inside its secure element so the private key material never materializes as a string in process memory.

### Batching

When processing multiple payments in one cold-signing session, build and sign several envelopes in a single batch to minimize the number of times you need to power-cycle the offline machine:

```ts
// Online: prepare five envelopes at once
const envelopes = payments.map((p) =>
  prepareOfflineStellarTransaction({
    source: sender,
    ops: [Operation.payment({ destination: p.to, asset: Asset.native(), amount: p.amount })],
    sequence: String(parseInt(baseSequence) + p.index),
    networkPassphrase,
  }),
);

// Transfer all five as a JSON array
// Offline: sign all five in one session
const signedXdrs = envelopes.map((env) => signOfflineStellarTransaction(env, secretKey));
```

### Error handling on submission

Always wrap the Horizon submission in a retry with exponential backoff. The offline functions will never mutate state — `submitOfflineStellarTransaction` is idempotent from the caller's perspective:

```ts
import { RPCRequestError } from '@wraith-protocol/sdk';

for (let attempt = 0; attempt < 3; attempt++) {
  try {
    const result = await submitOfflineStellarTransaction(signedXdr);
    return result;
  } catch (err) {
    if (err instanceof RPCRequestError && err.statusCode >= 500) {
      await sleep(1000 * 2 ** attempt); // exponential backoff
      continue;
    }
    throw err; // non-retryable: bad XDR, insufficient balance, etc.
  }
}
```

### Key derivation risk

`deriveStealthKeys` derives all stealth keys from a single 64-byte signature. If that signature is ever leaked, every stealth account derived from it is compromised. Consider:

- Signing the `STEALTH_SIGNING_MESSAGE` inside the offline signing environment so the raw signature never touches a networked machine.
- Rotating keys by signing a fresh message with a new nonce on a regular schedule.
- Using `deriveStealthPrivateScalar` only on the offline machine — the derived scalar is the actual signing key for a stealth account and must be treated with the same care as the master secret.
