#!/usr/bin/env tsx
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { resolve } from 'path';
import type { Checksum } from '../src/types';

function sha256File(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function main() {
  console.log('Verifying test vector checksums...\n');

  const checksumPath = resolve(import.meta.dirname, '../checksum.json');
  const checksum: Checksum = JSON.parse(readFileSync(checksumPath, 'utf8'));

  console.log(`Version: ${checksum.version}`);
  console.log(`Generated: ${checksum.generated}\n`);

  let allValid = true;

  for (const [filename, expectedHash] of Object.entries(checksum.files)) {
    const filepath = resolve(import.meta.dirname, '../vectors', filename);

    try {
      const content = readFileSync(filepath, 'utf8');
      const actualHash = sha256File(content);

      if (actualHash === expectedHash) {
        console.log(`✓ ${filename}`);
        console.log(`  SHA-256: ${actualHash.slice(0, 16)}...`);
      } else {
        console.log(`✗ ${filename} - CHECKSUM MISMATCH`);
        console.log(`  Expected: ${expectedHash.slice(0, 16)}...`);
        console.log(`  Actual:   ${actualHash.slice(0, 16)}...`);
        allValid = false;
      }
    } catch (err) {
      console.log(`✗ ${filename} - FILE NOT FOUND`);
      allValid = false;
    }

    console.log();
  }

  if (allValid) {
    console.log('✓ All checksums valid');
    process.exit(0);
  } else {
    console.log('✗ Some checksums failed');
    process.exit(1);
  }
}

main();
