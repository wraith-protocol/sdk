#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { run as runJscodeshift } from 'jscodeshift/src/Runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

function printUsage() {
  console.log(`
@wraith-protocol/codemod

Usage:
  npx @wraith-protocol/codemod <version> [path] [options]

Arguments:
  version       Transform set to run (e.g. "v1"). Matches a folder under
                transforms/.
  path          File or directory to transform. Defaults to the current
                directory.

Options:
  --dry         Run without writing any changes to disk.
  --print       Print transformed output to stdout (implies --dry unless
                combined with a write-enabled run).
  --extensions  Comma-separated list of file extensions to process.
                Defaults to "ts,tsx,js,jsx".
  --ignore      Glob pattern of files/directories to skip. Can be passed
                more than once. node_modules is always ignored.
  -h, --help    Show this help message.

Examples:
  npx @wraith-protocol/codemod v1 ./src
  npx @wraith-protocol/codemod v1 ./src --dry --print
`);
}

function parseArgs(argv) {
  const args = { flags: {}, positionals: [], ignore: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      args.flags.help = true;
    } else if (arg === '--dry') {
      args.flags.dry = true;
    } else if (arg === '--print') {
      args.flags.print = true;
    } else if (arg === '--extensions') {
      args.flags.extensions = argv[++i];
    } else if (arg === '--ignore') {
      args.ignore.push(argv[++i]);
    } else if (arg.startsWith('-')) {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    } else {
      args.positionals.push(arg);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.flags.help || args.positionals.length === 0) {
    printUsage();
    process.exit(args.flags.help ? 0 : 1);
  }

  const [version, targetArg] = args.positionals;
  const transformsDir = path.join(packageRoot, 'transforms', version);

  if (!fs.existsSync(transformsDir)) {
    console.error(`Unknown transform set "${version}" (no directory at ${transformsDir}).`);
    const available = fs
      .readdirSync(path.join(packageRoot, 'transforms'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    console.error(`Available transform sets: ${available.join(', ') || '(none)'}`);
    process.exit(1);
  }

  const transformFiles = fs
    .readdirSync(transformsDir)
    .filter((file) => file.endsWith('.cjs') || file.endsWith('.js'))
    .sort()
    .map((file) => path.join(transformsDir, file));

  if (transformFiles.length === 0) {
    console.error(`No transforms found in ${transformsDir}.`);
    process.exit(1);
  }

  const target = targetArg ? path.resolve(process.cwd(), targetArg) : process.cwd();
  if (!fs.existsSync(target)) {
    console.error(`Target path does not exist: ${target}`);
    process.exit(1);
  }

  const jscodeshiftOptions = {
    dry: Boolean(args.flags.dry),
    print: Boolean(args.flags.print),
    verbose: 0,
    babel: true,
    extensions: args.flags.extensions || 'ts,tsx,js,jsx',
    parser: 'tsx',
    ignorePattern: ['**/node_modules/**', ...args.ignore],
    silent: false,
    runInBand: false,
  };

  console.log(`@wraith-protocol/codemod: running "${version}" transforms against ${target}\n`);

  let anyErrors = false;

  for (const transformFile of transformFiles) {
    const name = path.basename(transformFile);
    console.log(`--- ${name} ---`);
    const result = await runJscodeshift(transformFile, [target], jscodeshiftOptions);
    if (result.error > 0) {
      anyErrors = true;
    }
    console.log('');
  }

  if (anyErrors) {
    console.error('One or more transforms reported errors. See output above.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
