# @wraith-protocol/test-vectors

Deterministic cryptographic test vectors for the [Wraith](https://github.com/wraith-protocol) Stellar stealth address protocol. Use these to verify that your reimplementation (Go, Rust, Swift, Python, …) produces byte-for-byte identical outputs to the reference TypeScript SDK.

## Structure

```
vectors/
  stellar.json  — Stellar (ed25519 + X25519 ECDH)
checksum.json   — SHA-256 of every vector file
```

Each file contains **100 vectors** for each of the 5 operation types:

| Field            | Description                                                         |
| ---------------- | ------------------------------------------------------------------- |
| `key_derivation` | Derive spending/viewing keypairs from a wallet signature            |
| `stealth_gen`    | Generate a one-time stealth address from a recipient's meta-address |
| `scan_match`     | Verify an announcement matches a recipient's viewing key            |
| `signing`        | Derive the stealth scalar and sign a transaction hash               |
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
    spending_scalar: String,
    spending_pub_key: String,
    viewing_pub_key: String,
}
#[derive(Deserialize)]
struct KeyDerivVector { input: KeyDerivInput, output: KeyDerivOutput }
#[derive(Deserialize)]
struct StellarVectors { key_derivation: Vec<KeyDerivVector> }

fn main() {
    let raw = fs::read_to_string("vectors/stellar.json").unwrap();
    let vecs: StellarVectors = serde_json::from_str(&raw).unwrap();

    for v in &vecs.key_derivation {
        let sig = hex::decode(&v.input.signature).unwrap();
        // call your derive_stealth_keys(sig) and compare with v.output
        let expected_spend_pub = &v.output.spending_pub_key;
        // assert_eq!(hex::encode(your_result.spending_pub_key), expected_spend_pub);
        println!("vector ok — spending_pub={}", &expected_spend_pub[..16]);
    }
}
```

---

### Go

```go
package main

import (
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
    SpendingScalar string `json:"spendingScalar"`
    SpendingPubKey string `json:"spendingPubKey"`
    ViewingPubKey  string `json:"viewingPubKey"`
}
type KeyDerivVector struct {
    Input  KeyDerivInput  `json:"input"`
    Output KeyDerivOutput `json:"output"`
}
type StellarVectors struct {
    KeyDerivation []KeyDerivVector `json:"key_derivation"`
}

func main() {
    data, _ := os.ReadFile("vectors/stellar.json")
    var vecs StellarVectors
    json.Unmarshal(data, &vecs)

    for i, v := range vecs.KeyDerivation {
        sig, _ := hex.DecodeString(v.Input.Signature)
        _ = sig
        // result := yourDeriveStealthKeys(sig)
        // assert result.SpendingPubKey == v.Output.SpendingPubKey
        fmt.Printf("vector %d: spendingPubKey=%s...\n", i, v.Output.SpendingPubKey[:16])
    }
}
```

---

### Python

```python
import json, hashlib

with open("vectors/stellar.json") as f:
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
    sig = bytes.fromhex(v["input"]["signature"])
    expected_spend_pub = v["output"]["spendingPubKey"]
    # result = your_derive_stealth_keys(sig)
    # assert result.spending_pub_key.hex() == expected_spend_pub
    print(f"  spendingPubKey={expected_spend_pub[:16]}...")

# Consume stealth_gen vectors
for v in vecs["stealth_gen"]:
    inp = v["input"]
    out = v["output"]
    # result = your_generate_stealth_address(
    #     bytes.fromhex(inp["spendingPubKey"]),
    #     bytes.fromhex(inp["viewingPubKey"]),
    #     bytes.fromhex(inp["ephemeralSeed"]),
    # )
    # assert result.stealth_address == out["stealthAddress"]
    # assert result.view_tag == out["viewTag"]
    print(f"  stealthAddress={out['stealthAddress'][:12]}...")

# Consume scan_match vectors
for v in vecs["scan_match"]:
    inp = v["input"]
    out = v["output"]
    # assert your_check_stealth(
    #     bytes.fromhex(inp["ephemeralPubKey"]),
    #     bytes.fromhex(inp["viewingKey"]),
    #     bytes.fromhex(inp["spendingPubKey"]),
    #     inp["viewTag"],
    # ).is_match == out["isMatch"]
    print(f"  match={out['isMatch']}  stealth={inp['stealthAddress'][:12]}...")
```

---

## JSON Schema

### Stellar (ed25519 + X25519 ECDH)

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
    "stealthAddress": "G...",
    "ephemeralPubKey": "<64 hex>",
    "viewTag": 42,
    "stealthPubKey": "<64 hex>"
  }
}
```

`scan_match` vector:

```json
{
  "input": {
    "ephemeralPubKey": "<64 hex>",
    "viewTag": 42,
    "stealthAddress": "G...",
    "viewingKey": "<64 hex>",
    "spendingPubKey": "<64 hex>",
    "spendingScalar": "<decimal bigint>"
  },
  "output": {
    "isMatch": true,
    "stealthPrivateScalar": "<decimal bigint>",
    "stealthPubKey": "<64 hex>"
  }
}
```

`signing` vector:

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

`encoding` vector:

```json
{
  "input": { "spendingPubKey": "<64 hex>", "viewingPubKey": "<64 hex>" },
  "output": {
    "metaAddress": "st:xlm:<128 hex>",
    "decodedSpendingPubKey": "<64 hex>",
    "decodedViewingPubKey": "<64 hex>"
  }
}
```

---

## Cryptographic Notes

| Chain   | Curve            | ECDH   | View-tag source                                           |
| ------- | ---------------- | ------ | --------------------------------------------------------- |
| Stellar | ed25519 / X25519 | SHA-256 | `SHA-256("wraith:stellar:view-tag:v2:" \|\| R \|\| V)[0]` |

Key derivation from a 64-byte ed25519 wallet signature:

- `spending_key = SHA-256("wraith:spending:" || sig)`
- `viewing_key  = SHA-256("wraith:viewing:"  || sig)`

Stealth scalar derivation:

```
shared_secret  = X25519(edwardsToMontgomery(viewing_key), edwardsToMontgomery(eph_seed))
hash_scalar    = SHA-256("wraith:scalar:" || shared_secret) mod L  (little-endian)
stealth_scalar = (spending_scalar + hash_scalar) mod L
stealth_pubkey = spending_pubkey + hash_scalar * G
```

## License

MIT
