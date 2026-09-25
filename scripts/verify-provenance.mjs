#!/usr/bin/env node
/**
 * Verifies the provenance attestation npm generated for the version just
 * published (issue #210).
 *
 * `pnpm publish --provenance` asks the registry to attach a signed SLSA-style
 * attestation linking the tarball to this GitHub Actions run. Publishing with the
 * flag but never reading the result means a silently unattested release looks
 * identical to an attested one, so the publish workflow asserts the attestation
 * exists before it reports success.
 *
 * The registry needs a moment to expose the attestation after the upload, hence
 * the bounded retry.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const spec = `${pkg.name}@${pkg.version}`;
const attempts = Number(process.env.PROVENANCE_ATTEMPTS ?? 6);

function metadata() {
  const raw = execFileSync('npm', ['view', spec, '--json'], { encoding: 'utf8' });
  return JSON.parse(raw);
}

let attestations;
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const view = metadata();
    attestations = (view.dist ?? {}).attestations;
    if (attestations?.provenance) break;
  } catch (error) {
    if (attempt === attempts) {
      console.error(`error: could not read registry metadata for ${spec}: ${error.message}`);
      process.exit(1);
    }
  }
  console.log(`attestation not visible yet, retrying (${attempt}/${attempts})...`);
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

const provenance = attestations?.provenance;
if (!provenance) {
  console.error(
    `error: ${spec} has no provenance attestation. Check that the publish step ran with --provenance and that the workflow still declares "id-token: write".`,
  );
  process.exit(1);
}

console.log(`${spec} provenance attestation present:`);
console.log(`  predicate type: ${provenance.predicateType ?? 'unknown'}`);
console.log(`  url:            ${provenance.url ?? 'unknown'}`);
