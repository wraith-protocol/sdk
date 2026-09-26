#!/usr/bin/env tsx
/**
 * Computes SHA-256 checksums for every JSON file in vectors/ and writes checksum.json.
 */

import { createHash } from 'crypto';
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS_DIR = join(__dirname, '..', 'vectors');
const OUT = join(__dirname, '..', 'checksum.json');

const files = readdirSync(VECTORS_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

const checksums: Record<string, string> = {};
for (const file of files) {
  const data = readFileSync(join(VECTORS_DIR, file));
  checksums[`vectors/${file}`] = createHash('sha256').update(data).digest('hex');
}

writeFileSync(OUT, JSON.stringify({ algorithm: 'sha256', files: checksums }, null, 2) + '\n');
console.log('wrote checksum.json');
for (const [k, v] of Object.entries(checksums)) {
  console.log(`  ${v}  ${k}`);
}
