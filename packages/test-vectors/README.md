# @wraith-protocol/test-vectors

Deterministic test vectors for cross-language verification of Wraith stealth address cryptography. Use these vectors to ensure your Rust, Go, Python, Swift, or other implementations match the reference TypeScript SDK.

## Installation

```bash
npm install @wraith-protocol/test-vectors
# or
pnpm add @wraith-protocol/test-vectors
```

## What's Included

This package provides **100+ test vectors per operation** for each supported chain:

- **EVM** (Ethereum, Polygon, Base, Horizen): secp256k1 + keccak256
- **Stellar**: ed25519 + X25519 ECDH + SHA-256
- **Solana**: ed25519 + X25519 ECDH + SHA-256
- **CKB** (Nervos): secp256k1 + blake2b

### Vector Types

Each chain includes vectors for:

1. **Key Derivation** — Derive spending/viewing keys from wallet signatures
2. **Stealth Generation** — Generate one-time stealth addresses
3. **Scan Matching** — Identify payments (with view tags)
4. **Signing** — Sign transactions with stealth private keys
5. **Encoding** — Encode/decode stealth meta-addresses

### Files

```
vectors/
  evm.json       # EVM test vectors
  stellar.json   # Stellar test vectors
  solana.json    # Solana test vectors
  ckb.json       # CKB test vectors
checksum.json    # SHA-256 checksums for all vector files
```

## Usage

### TypeScript / JavaScript

```typescript
import {
  evmVectors,
  stellarVectors,
  solanaVectors,
  ckbVectors,
  checksum,
} from '@wraith-protocol/test-vectors';

// Access specific vector types
const { keyDerivation, stealthGeneration, scanMatch, signing, encoding } = evmVectors;

// Verify your implementation
for (const vector of keyDerivation) {
  const keys = deriveStealthKeys(vector.signature);
  assert(keys.spendingKey === vector.spendingKey);
  assert(keys.viewingKey === vector.viewingKey);
  assert(keys.spendingPubKey === vector.spendingPubKey);
  assert(keys.viewingPubKey === vector.viewingPubKey);
}
```

### Rust

```rust
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Deserialize)]
struct VectorSet {
    version: String,
    chain: String,
    description: String,
    #[serde(rename = "keyDerivation")]
    key_derivation: Vec<KeyDerivationVector>,
    #[serde(rename = "stealthGeneration")]
    stealth_generation: Vec<StealthGenerationVector>,
    #[serde(rename = "scanMatch")]
    scan_match: Vec<ScanMatchVector>,
    signing: Vec<SigningVector>,
    encoding: Vec<EncodingVector>,
}

#[derive(Debug, Deserialize)]
struct KeyDerivationVector {
    signature: String,
    #[serde(rename = "spendingKey")]
    spending_key: String,
    #[serde(rename = "viewingKey")]
    viewing_key: String,
    #[serde(rename = "spendingPubKey")]
    spending_pub_key: String,
    #[serde(rename = "viewingPubKey")]
    viewing_pub_key: String,
}

fn main() {
    // Load vectors
    let data = fs::read_to_string("node_modules/@wraith-protocol/test-vectors/vectors/evm.json")
        .expect("Failed to read vectors");
    let vectors: VectorSet = serde_json::from_str(&data).expect("Failed to parse JSON");

    // Run tests
    for vector in vectors.key_derivation {
        let keys = derive_stealth_keys(&vector.signature);
        assert_eq!(hex::encode(keys.spending_key), vector.spending_key[2..]);
        assert_eq!(hex::encode(keys.viewing_key), vector.viewing_key[2..]);
        assert_eq!(hex::encode(keys.spending_pub_key), vector.spending_pub_key[2..]);
        assert_eq!(hex::encode(keys.viewing_pub_key), vector.viewing_pub_key[2..]);
    }

    println!("✓ All {} key derivation tests passed", vectors.key_derivation.len());
}
```

### Go

```go
package main

import (
    "encoding/json"
    "fmt"
    "os"
)

type VectorSet struct {
    Version            string                   `json:"version"`
    Chain              string                   `json:"chain"`
    Description        string                   `json:"description"`
    KeyDerivation      []KeyDerivationVector    `json:"keyDerivation"`
    StealthGeneration  []StealthGenerationVector `json:"stealthGeneration"`
    ScanMatch          []ScanMatchVector        `json:"scanMatch"`
    Signing            []SigningVector          `json:"signing"`
    Encoding           []EncodingVector         `json:"encoding"`
}

type KeyDerivationVector struct {
    Signature      string `json:"signature"`
    SpendingKey    string `json:"spendingKey"`
    ViewingKey     string `json:"viewingKey"`
    SpendingPubKey string `json:"spendingPubKey"`
    ViewingPubKey  string `json:"viewingPubKey"`
}

func main() {
    // Load vectors
    data, err := os.ReadFile("node_modules/@wraith-protocol/test-vectors/vectors/evm.json")
    if err != nil {
        panic(err)
    }

    var vectors VectorSet
    if err := json.Unmarshal(data, &vectors); err != nil {
        panic(err)
    }

    // Run tests
    for _, vector := range vectors.KeyDerivation {
        keys := DeriveStealthKeys(vector.Signature)
        if keys.SpendingKey != vector.SpendingKey {
            panic(fmt.Sprintf("Spending key mismatch: got %s, want %s", keys.SpendingKey, vector.SpendingKey))
        }
        if keys.ViewingKey != vector.ViewingKey {
            panic(fmt.Sprintf("Viewing key mismatch: got %s, want %s", keys.ViewingKey, vector.ViewingKey))
        }
    }

    fmt.Printf("✓ All %d key derivation tests passed\n", len(vectors.KeyDerivation))
}
```

### Python

```python
import json
from pathlib import Path

# Load vectors
vectors_path = Path("node_modules/@wraith-protocol/test-vectors/vectors/evm.json")
with open(vectors_path) as f:
    vectors = json.load(f)

# Run tests
for vector in vectors["keyDerivation"]:
    keys = derive_stealth_keys(vector["signature"])
    assert keys.spending_key.hex() == vector["spendingKey"][2:], "Spending key mismatch"
    assert keys.viewing_key.hex() == vector["viewingKey"][2:], "Viewing key mismatch"
    assert keys.spending_pub_key.hex() == vector["spendingPubKey"][2:], "Spending pub key mismatch"
    assert keys.viewing_pub_key.hex() == vector["viewingPubKey"][2:], "Viewing pub key mismatch"

print(f"✓ All {len(vectors['keyDerivation'])} key derivation tests passed")
```

### Swift

```swift
import Foundation

struct VectorSet: Codable {
    let version: String
    let chain: String
    let description: String
    let keyDerivation: [KeyDerivationVector]
    let stealthGeneration: [StealthGenerationVector]
    let scanMatch: [ScanMatchVector]
    let signing: [SigningVector]
    let encoding: [EncodingVector]
}

struct KeyDerivationVector: Codable {
    let signature: String
    let spendingKey: String
    let viewingKey: String
    let spendingPubKey: String
    let viewingPubKey: String
}

// Load vectors
let url = Bundle.main.url(forResource: "evm", withExtension: "json")!
let data = try! Data(contentsOf: url)
let vectors = try! JSONDecoder().decode(VectorSet.self, from: data)

// Run tests
for vector in vectors.keyDerivation {
    let keys = deriveStealthKeys(signature: vector.signature)
    assert(keys.spendingKey == vector.spendingKey, "Spending key mismatch")
    assert(keys.viewingKey == vector.viewingKey, "Viewing key mismatch")
    assert(keys.spendingPubKey == vector.spendingPubKey, "Spending pub key mismatch")
    assert(keys.viewingPubKey == vector.viewingPubKey, "Viewing pub key mismatch")
}

print("✓ All \(vectors.keyDerivation.count) key derivation tests passed")
```

## Vector Format

### Key Derivation

```json
{
  "signature": "0x...",
  "spendingKey": "0x...",
  "viewingKey": "0x...",
  "spendingPubKey": "0x...",
  "viewingPubKey": "0x...",
  "spendingScalar": "0x...", // ed25519 only
  "viewingScalar": "0x..." // ed25519 only
}
```

### Stealth Generation

```json
{
  "spendingPubKey": "0x...",
  "viewingPubKey": "0x...",
  "ephemeralPrivateKey": "0x...",
  "ephemeralPubKey": "0x...",
  "stealthAddress": "0x...",
  "viewTag": 42
}
```

### Scan Match

```json
{
  "viewingKey": "0x...",
  "spendingPubKey": "0x...",
  "spendingKey": "0x...",
  "ephemeralPubKey": "0x...",
  "stealthAddress": "0x...",
  "viewTag": 42,
  "shouldMatch": true,
  "stealthPrivateKey": "0x...", // secp256k1 only
  "stealthPrivateScalar": "0x..." // ed25519 only
}
```

### Signing

```json
{
  "privateKey": "0x...",
  "message": "0x...",
  "signature": "0x...",
  "publicKey": "0x..."
}
```

### Encoding

```json
{
  "spendingPubKey": "0x...",
  "viewingPubKey": "0x...",
  "metaAddress": "st:eth:0x..."
}
```

## Checksum Verification

The `checksum.json` file contains SHA-256 hashes of all vector files. Verify integrity:

```typescript
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { checksum } from '@wraith-protocol/test-vectors';

const vectorFile = readFileSync(
  'node_modules/@wraith-protocol/test-vectors/vectors/evm.json',
  'utf8',
);
const hash = createHash('sha256').update(vectorFile).digest('hex');

if (hash !== checksum.files['evm.json']) {
  throw new Error('Checksum mismatch - vectors may be corrupted');
}
```

## Regenerating Vectors

Vectors are deterministically generated from the seed `wraith-test-vectors-v1`:

```bash
cd packages/test-vectors
pnpm generate
```

This ensures identical vectors across environments and versions.

## Chain-Specific Notes

### EVM

- Uses secp256k1 for all elliptic curve operations
- Keccak256 for hashing
- Signatures are 65 bytes (r ‖ s ‖ v)
- Addresses are checksummed (EIP-55)

### Stellar

- Uses ed25519 for signing
- X25519 ECDH for shared secrets
- SHA-256 for hashing
- View tags computed from public announcement data only
- Addresses are base32-encoded with checksums

### Solana

- Same cryptography as Stellar (ed25519 + X25519)
- Uses Solana's base58 address encoding
- View tag computation identical to Stellar

### CKB (Nervos)

- Uses secp256k1 like EVM
- Blake2b hashing instead of keccak256
- UTXO-based model (Cells)
- No separate announcer contract

## Version History

- **v1.0.0** — Initial release with 100+ vectors per chain

## License

MIT

## Resources

- [Wraith Protocol Documentation](https://github.com/wraith-protocol/docs)
- [Wraith SDK](https://github.com/wraith-protocol/sdk)
- [ERC-5564 Stealth Address Standard](https://eips.ethereum.org/EIPS/eip-5564)
