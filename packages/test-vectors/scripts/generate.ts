#!/usr/bin/env tsx
import { writeFileSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { resolve } from 'path';
import type { VectorSet, Checksum } from '../src/types';
import { generateEVMVectors } from './generators/evm';
import { generateStellarVectors } from './generators/stellar';
import { generateSolanaVectors } from './generators/solana';
import { generateCKBVectors } from './generators/ckb';

const SEED = 'wraith-test-vectors-v1';
const VECTORS_PER_TYPE = 100;

function sha256File(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

async function main() {
  console.log('Generating test vectors...');
  console.log(`Seed: ${SEED}`);
  console.log(`Vectors per type: ${VECTORS_PER_TYPE}\n`);

  const vectorsDir = resolve(import.meta.dirname, '../vectors');
  mkdirSync(vectorsDir, { recursive: true });

  const generators = [
    { name: 'evm', fn: generateEVMVectors },
    { name: 'stellar', fn: generateStellarVectors },
    { name: 'solana', fn: generateSolanaVectors },
    { name: 'ckb', fn: generateCKBVectors },
  ];

  const checksums: Record<string, string> = {};

  for (const { name, fn } of generators) {
    console.log(`Generating ${name} vectors...`);
    const vectors = fn(SEED, VECTORS_PER_TYPE);
    const json = JSON.stringify(vectors, null, 2);
    const filename = `${name}.json`;
    const filepath = resolve(vectorsDir, filename);

    writeFileSync(filepath, json, 'utf8');
    checksums[filename] = sha256File(json);
    console.log(
      `✓ ${filename} (${json.length} bytes, SHA-256: ${checksums[filename].slice(0, 16)}...)\n`,
    );
  }

  const checksum: Checksum = {
    version: '1.0.0',
    generated: new Date().toISOString(),
    files: checksums,
  };

  const checksumJson = JSON.stringify(checksum, null, 2);
  const checksumPath = resolve(import.meta.dirname, '../checksum.json');
  writeFileSync(checksumPath, checksumJson, 'utf8');

  console.log('✓ checksum.json generated');
  console.log('\nAll test vectors generated successfully!');
  console.log(`Total files: ${Object.keys(checksums).length + 1}`);
}

main().catch((err) => {
  console.error('Failed to generate test vectors:', err);
  process.exit(1);
});
