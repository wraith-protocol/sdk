import { readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

function isPackageReport(reportFolder, filename, packageName) {
  const name = packageName.split('/').at(-1);
  if (!filename.endsWith('.public.api.md')) return false;
  if (filename !== name + '.public.api.md' && !filename.startsWith(name + '-')) return false;

  // Neighboring packages can share a filename prefix (for example sdk-react and sdk-react-native).
  const header = readFileSync(join(reportFolder, filename), 'utf8').split(/\r?\n/, 1)[0];
  return header === '## Public API Report File for "' + packageName + '"';
}

export function reconcileCompanionReportInventory({
  reportFolder,
  packageName,
  expectedReports,
  update,
}) {
  const expected = new Set(expectedReports);
  const files = readdirSync(reportFolder, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const missing = [...expected].filter((name) => !files.includes(name));
  if (missing.length) return missing.map((name) => 'Missing companion API report: ' + name);

  const stale = files.filter(
    (name) => !expected.has(name) && isPackageReport(reportFolder, name, packageName),
  );
  if (!update) return stale.map((name) => 'Stale companion API report: ' + name);
  for (const name of stale) unlinkSync(join(reportFolder, name));
  return [];
}
