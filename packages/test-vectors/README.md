# @wraith-protocol/test-vectors

Deterministic cryptographic test vectors for the [Wraith](https://github.com/wraith-protocol) stealth address protocol. Use these to verify that your reimplementation (Go, Rust, Swift, Python, …) produces byte-for-byte identical outputs to the reference TypeScript SDK.

## Structure

```
vectors/
  evm.json      — EVM (secp256k1 + keccak256)
  stellar.json  — Stellar (ed25519 + X25519 ECDH)
  solana.json   — Solana  (ed25519 + X25519 ECDH)
  ckb.json      — CKB     (secp256k1 + SHA-256 + blake2b)
checksum.json   — SHA-256 of every vector file
```

Each file contains **100 vectors** for each of the 5 operation types:

| Field            | Description                                                         |
| ---------------- | ------------------------------------------------------------------- |
| `key_derivation` | Derive spending/viewing keypairs from a wallet signature            |
| `stealth_gen`    | Generate a one-time stealth address from a recipient's meta-address |
| `scan_match`     | Verify an announcement matches a recipient's viewing key            |
| `signing`        | Derive the stealth private key / scalar and optionally sign         |
| `encoding`       | Encode / decode stealth meta-addresses                              |

All vectors are generated deterministically from seed `0x57524149` ("WRAI").

## Verifying Checksums

```bash
# Node
node -e "
const {createHash} = require('crypto');
const {readFileSync} = require('fs');
const {files} = JSON.parse(readFileSync('checksum.json'));
for (const [f, expected] of Object.entries(files)) {
  const actual = createHash('sha256').update(readFileSync(f)).digest('hex');
  console.log(actual === expected ? 'OK' : 'FAIL', f);
}
"
```

---

## Consumption Examples

### Rust

```toml
# Cargo.toml
[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
hex = "0.4"
```

```rust
use serde::Deserialize;
use std::fs;

#[derive(Deserialize)]
struct KeyDerivInput { signature: String }
#[derive(Deserialize)]
struct KeyDerivOutput {
    spending_key: String,
    viewing_key: String,
    spending_pub_key: String,
    viewing_pub_key: String,
}
#[derive(Deserialize)]
struct KeyDerivVector { input: KeyDerivInput, output: KeyDerivOutput }
#[derive(Deserialize)]
struct EvmVectors { key_derivation: Vec<KeyDerivVector> }

fn main() {
    let raw = fs::read_to_string("vectors/evm.json").unwrap();
    let vecs: EvmVectors = serde_json::from_str(&raw).unwrap();

    for v in &vecs.key_derivation {
        let sig = hex::decode(v.input.signature.trim_start_matches("0x")).unwrap();
        // call your derive_stealth_keys(sig) and compare with v.output
        let expected_spend = v.output.spending_key.trim_start_matches("0x");
        // assert_eq!(hex::encode(your_result.spending_key), expected_spend);
        println!("vector ok — spending_pub={}", &v.output.spending_pub_key[..16]);
    }
}
```

---

### Go

```go
package main

import (
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "fmt"
    "os"
)

type KeyDerivInput struct {
    Signature string `json:"signature"`
}
type KeyDerivOutput struct {
    SpendingKey    string `json:"spendingKey"`
    ViewingKey     string `json:"viewingKey"`
    SpendingPubKey string `json:"spendingPubKey"`
    ViewingPubKey  string `json:"viewingPubKey"`
}
type KeyDerivVector struct {
    Input  KeyDerivInput  `json:"input"`
    Output KeyDerivOutput `json:"output"`
}
type EVMVectors struct {
    KeyDerivation []KeyDerivVector `json:"key_derivation"`
}

func main() {
    data, _ := os.ReadFile("vectors/evm.json")
    var vecs EVMVectors
    json.Unmarshal(data, &vecs)

    for i, v := range vecs.KeyDerivation {
        sig, _ := hex.DecodeString(v.Input.Signature[2:]) // strip 0x
        // r = sig[0:32], s = sig[32:64]
        r := sig[:32]
        spendHash := sha256.Sum256(r) // placeholder — real impl uses keccak256
        _ = spendHash
        fmt.Printf("vector %d: spendingPubKey=%s...\n", i, v.Output.SpendingPubKey[:12])
    }
}
```

---

### Python

```python
import json, hashlib

with open("vectors/evm.json") as f:
    vecs = json.load(f)

# Verify checksums first
with open("checksum.json") as f:
    checksums = json.load(f)["files"]

for path, expected in checksums.items():
    with open(path, "rb") as f:
        actual = hashlib.sha256(f.read()).hexdigest()
    assert actual == expected, f"Checksum mismatch: {path}"

print("Checksums OK")

# Consume key_derivation vectors
for v in vecs["key_derivation"]:
    sig = bytes.fromhex(v["input"]["signature"].lstrip("0x"))
    expected_spend_pub = v["output"]["spendingPubKey"].lstrip("0x")
    # result = your_derive_stealth_keys(sig)
    # assert result.spending_pub_key.hex() == expected_spend_pub
    print(f"  spendingPubKey={expected_spend_pub[:16]}...")

# Consume stealth_gen vectors
for v in vecs["stealth_gen"]:
    inp = v["input"]
    out = v["output"]
    # result = your_generate_stealth_address(
    #     bytes.fromhex(inp["spendingPubKey"].lstrip("0x")),
    #     bytes.fromhex(inp["viewingPubKey"].lstrip("0x")),
    #     bytes.fromhex(inp["ephemeralPrivateKey"].lstrip("0x")),
    # )
    # assert result.stealth_address == out["stealthAddress"]
    # assert result.view_tag == out["viewTag"]
    print(f"  stealthAddress={out['stealthAddress'][:12]}...")
```

---

## JSON Schema

### EVM / CKB (secp256k1 chains)

`key_derivation` vector:

```json
{
  "input": { "signature": "0x<130 hex chars>" },
  "output": {
    "spendingKey": "0x<64 hex chars>",
    "viewingKey": "0x<64 hex chars>",
    "spendingPubKey": "0x<66 hex chars>",
    "viewingPubKey": "0x<66 hex chars>"
  }
}
```

`stealth_gen` vector (EVM):

```json
{
  "input": { "spendingPubKey": "0x...", "viewingPubKey": "0x...", "ephemeralPrivateKey": "0x..." },
  "output": { "stealthAddress": "0x<40 hex>", "ephemeralPubKey": "0x<66 hex>", "viewTag": 42 }
}
```

`stealth_gen` vector (CKB):

```json
{
  "input": { "spendingPubKey": "0x...", "viewingPubKey": "0x...", "ephemeralPrivateKey": "0x..." },
  "output": {
    "stealthPubKey": "0x<66 hex>",
    "stealthPubKeyHash": "0x<40 hex>",
    "ephemeralPubKey": "0x<66 hex>",
    "lockArgs": "0x<106 hex>"
  }
}
```

### Stellar / Solana (ed25519 chains)

`key_derivation` vector:

```json
{
  "input": { "signature": "<128 hex chars>" },
  "output": {
    "spendingKey": "<64 hex>",
    "viewingKey": "<64 hex>",
    "spendingScalar": "<decimal bigint>",
    "spendingPubKey": "<64 hex>",
    "viewingPubKey": "<64 hex>"
  }
}
```

`stealth_gen` vector:

```json
{
  "input": {
    "spendingPubKey": "<64 hex>",
    "viewingPubKey": "<64 hex>",
    "ephemeralSeed": "<64 hex>"
  },
  "output": {
    "stealthAddress": "G... (Stellar) or base58 (Solana)",
    "ephemeralPubKey": "<64 hex>",
    "viewTag": 42,
    "stealthPubKey": "<64 hex>"
  }
}
```

`signing` vector (Stellar / Solana):

```json
{
  "input": {
    "transactionHash": "<64 hex>",
    "stealthScalar": "<decimal bigint>",
    "stealthPubKey": "<64 hex>"
  },
  "output": { "signature": "<128 hex>" }
}
```

---

## Cryptographic Notes

| Chain   | Curve            | ECDH Hash | View-tag source                                           |
| ------- | ---------------- | --------- | --------------------------------------------------------- |
| EVM     | secp256k1        | keccak256 | `hashedSecret[0]`                                         |
| Stellar | ed25519 / X25519 | SHA-256   | `SHA-256("wraith:stellar:view-tag:v2:" \|\| R \|\| V)[0]` |
| Solana  | ed25519 / X25519 | SHA-256   | `SHA-256("wraith:tag:" \|\| sharedSecret)[0]`             |
| CKB     | secp256k1        | SHA-256   | none (full scan)                                          |

Scalar derivation for all chains: `p_stealth = (spending_scalar + hash_scalar) mod curve_order`

For Stellar/Solana: `hash_scalar = SHA-256("wraith:scalar:" || sharedSecret) mod L` (little-endian)

## License

MIT
