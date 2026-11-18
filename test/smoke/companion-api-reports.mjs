import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Extractor, ExtractorConfig } from '@microsoft/api-extractor';

import { reconcileCompanionReportInventory } from './companion-report-inventory.mjs';

export function checkCompanionReports({
  packageDir,
  manifest,
  entrypoints,
  reportFolder,
  tempFolder,
  update,
}) {
  mkdirSync(reportFolder, { recursive: true });
  mkdirSync(tempFolder, { recursive: true });

  const name = manifest.name.split('/').at(-1);
  const problems = [];
  const expectedReports = [];
  if (name === 'test-vectors') {
    // Keep tracking published JSON when the package also exposes typed entry points.
    const files = readdirSync(packageDir, { recursive: true })
      .map((file) => file.replaceAll('\\', '/'))
      .filter((file) => file.endsWith('.json') && file !== 'package.json')
      .sort();
    const report = [
      '# Published test vector files',
      '',
      ...files.map((file) => '- `' + file + '`'),
      '',
    ].join('\n');
    expectedReports.push('test-vectors.api.md');
    const baseline = join(reportFolder, 'test-vectors.api.md');
    if (update) writeFileSync(baseline, report);
    else {
      let matches = false;
      try {
        matches = readFileSync(baseline, 'utf8').replaceAll('\r\n', '\n') === report;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (!matches) problems.push('test-vectors.api.md differs from the packed JSON file list');
    }
  }

  for (const { subpath, typesRel } of entrypoints) {
    if (!typesRel) {
      const dataOnly =
        name === 'test-vectors' && !manifest.exports && !manifest.main && !manifest.module;
      if (!dataOnly) problems.push(`API ${subpath}: missing packed types entry`);
      continue;
    }

    const suffix = subpath === '.' ? '' : `-${subpath.slice(2).replaceAll('/', '-')}`;
    const reportFileName = `${name}${suffix}`;
    expectedReports.push(`${reportFileName}.public.api.md`);
    const entry = resolve(packageDir, typesRel);
    const config = ExtractorConfig.prepare({
      configObjectFullPath: undefined,
      packageJsonFullPath: join(packageDir, 'package.json'),
      configObject: {
        projectFolder: packageDir,
        newlineKind: 'lf',
        mainEntryPointFilePath: entry,
        compiler: {
          overrideTsconfig: {
            compilerOptions: {
              module: 'esnext',
              moduleResolution: 'bundler',
              target: 'es2020',
              skipLibCheck: true,
            },
            files: [entry],
          },
        },
        apiReport: {
          enabled: true,
          reportFileName,
          reportVariants: ['public'],
          includeForgottenExports: true,
          reportFolder,
          reportTempFolder: tempFolder,
        },
        docModel: { enabled: false },
        dtsRollup: { enabled: false },
        tsdocMetadata: { enabled: false },
        messages: {
          extractorMessageReporting: { 'ae-missing-release-tag': { logLevel: 'none' } },
        },
      },
    });
    const result = Extractor.invoke(config, { localBuild: update });
    if (!result.succeeded || (!update && result.apiReportChanged)) {
      problems.push(`API ${subpath}: check ${reportFileName}.public.api.md`);
    }
  }
  if (problems.length === 0) {
    problems.push(
      ...reconcileCompanionReportInventory({
        reportFolder,
        packageName: manifest.name,
        expectedReports,
        update,
      }),
    );
  }
  return problems;
}
