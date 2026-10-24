import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));
const { packageManager } = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

if (!packageManager) {
  console.error('error: package.json has no "packageManager" field');
  process.exit(1);
}

const [name, pinnedVersion] = packageManager.split('@');
const pinnedMajor = Number(pinnedVersion.split('.')[0]);

let actualVersion;
try {
  actualVersion = execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim();
} catch {
  console.error('error: pnpm is not available on PATH');
  process.exit(1);
}

const actualMajor = Number(actualVersion.split('.')[0]);

if (actualMajor !== pinnedMajor) {
  console.error(
    `error: pnpm major version mismatch: lockfile pinned to ${packageManager}, but running pnpm@${actualVersion}`,
  );
  console.error('Re-run install with the pinned pnpm major before modifying the lockfile.');
  process.exit(1);
}

console.log(`ok: pnpm@${actualVersion} matches ${packageManager}`);
