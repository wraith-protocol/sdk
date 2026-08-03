#!/usr/bin/env node
/**
 * Runs every vector in vectors/stellar.json through whatever
 * `@wraith-protocol/sdk/chains/stellar` resolves to from this script's own
 * location, and prints the results as JSON on stdout.
 *
 * This file is executed unmodified in two different working directories by
 * differential.ts: once against the workspace's own build (the "tip"), and
 * once copied into a scratch install of the pinned reference version (the
 * "reference"). Node's normal module resolution is what picks the SDK
 * version — the script itself never hardcodes a path — so both runs exercise
 * identical logic against whatever package version is actually installed.
 */

function hexToBytesLocal(hex) {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHexLocal(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function run(vectorsPath) {
  const { readFileSync } = await import('fs');
  const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8'));
  const sdk = await import('@wraith-protocol/sdk/chains/stellar');

  const results = {
    key_derivation: [],
    stealth_gen: [],
    scan_match: [],
    signing: [],
    encoding: [],
  };

  for (const v of vectors.key_derivation) {
    try {
      const sig = hexToBytesLocal(v.input.signature);
      const keys = sdk.deriveStealthKeys(sig);
      results.key_derivation.push({
        spendingKey: bytesToHexLocal(keys.spendingKey),
        viewingKey: bytesToHexLocal(keys.viewingKey),
        spendingScalar: keys.spendingScalar.toString(),
        spendingPubKey: bytesToHexLocal(keys.spendingPubKey),
        viewingPubKey: bytesToHexLocal(keys.viewingPubKey),
      });
    } catch (err) {
      results.key_derivation.push({ __error: String(err && err.message ? err.message : err) });
    }
  }

  for (const v of vectors.stealth_gen) {
    try {
      const spendPub = hexToBytesLocal(v.input.spendingPubKey);
      const viewPub = hexToBytesLocal(v.input.viewingPubKey);
      const ephSeed = hexToBytesLocal(v.input.ephemeralSeed);
      const gen = sdk.generateStealthAddress(spendPub, viewPub, ephSeed);
      results.stealth_gen.push({
        stealthAddress: gen.stealthAddress,
        ephemeralPubKey: bytesToHexLocal(gen.ephemeralPubKey),
        viewTag: gen.viewTag,
        stealthPubKey: gen.stealthPubKey ? bytesToHexLocal(gen.stealthPubKey) : null,
      });
    } catch (err) {
      results.stealth_gen.push({ __error: String(err && err.message ? err.message : err) });
    }
  }

  for (const v of vectors.scan_match) {
    try {
      const ephPub = hexToBytesLocal(v.input.ephemeralPubKey);
      const viewingKey = hexToBytesLocal(v.input.viewingKey);
      const spendingPubKey = hexToBytesLocal(v.input.spendingPubKey);
      const spendingScalar = BigInt(v.input.spendingScalar);

      const check = sdk.checkStealthAddress(ephPub, viewingKey, spendingPubKey, v.input.viewTag);
      const stealthPrivateScalar = sdk.deriveStealthPrivateScalar(
        spendingScalar,
        viewingKey,
        ephPub,
      );

      results.scan_match.push({
        isMatch: check.isMatch,
        stealthPrivateScalar: stealthPrivateScalar.toString(),
        stealthPubKey:
          check.stealthPubKeyBytes !== null && check.stealthPubKeyBytes !== undefined
            ? bytesToHexLocal(check.stealthPubKeyBytes)
            : null,
      });
    } catch (err) {
      results.scan_match.push({ __error: String(err && err.message ? err.message : err) });
    }
  }

  for (const v of vectors.signing) {
    try {
      const txHash = hexToBytesLocal(v.input.transactionHash);
      const stealthScalar = BigInt(v.input.stealthScalar);
      const stealthPubKey = hexToBytesLocal(v.input.stealthPubKey);
      const sig = sdk.signStellarTransaction(txHash, stealthScalar, stealthPubKey);
      results.signing.push({ signature: bytesToHexLocal(sig) });
    } catch (err) {
      results.signing.push({ __error: String(err && err.message ? err.message : err) });
    }
  }

  for (const v of vectors.encoding) {
    try {
      const spendingPubKey = hexToBytesLocal(v.input.spendingPubKey);
      const viewingPubKey = hexToBytesLocal(v.input.viewingPubKey);
      const metaAddress = sdk.encodeStealthMetaAddress(spendingPubKey, viewingPubKey);
      const decoded = sdk.decodeStealthMetaAddress(metaAddress);
      results.encoding.push({
        metaAddress,
        decodedSpendingPubKey: bytesToHexLocal(decoded.spendingPubKey),
        decodedViewingPubKey: bytesToHexLocal(decoded.viewingPubKey),
      });
    } catch (err) {
      results.encoding.push({ __error: String(err && err.message ? err.message : err) });
    }
  }

  process.stdout.write(JSON.stringify(results));
}

const vectorsPath = process.argv[2];
if (!vectorsPath) {
  console.error('usage: differential-runner.mjs <path-to-vectors.json>');
  process.exit(2);
}

run(vectorsPath).catch((err) => {
  console.error(err);
  process.exit(1);
});
