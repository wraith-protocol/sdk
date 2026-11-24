# Package entry point smoke tests

These checks import the built package the way a real consumer does, so a broken
`exports` map, a missing build artifact, an accidental Node-only import, or an
unresolvable declaration file is caught before release.

Run them against a fresh build:

```bash
pnpm build
pnpm test:exports
```

`run.mjs` drives five isolated child processes:

- `import-esm.mjs` asserts every `exports` entry loads through its `import`
  condition and exposes at least one export.
- `require-cjs.cjs` asserts every `exports` entry loads through its `require`
  condition and exposes at least one export.
- `check-node-free.mjs` asserts no entry point's authored source imports a
  `node:*` or bare Node builtin, so the browser-safe entry points stay
  browser-safe.
- `check-types.mjs` asserts every `types` target exists and type-checks when
  imported by its package specifier.
- `pack-install.mjs` packs `@wraith-protocol/sdk` into a tarball, installs it
  with both `npm install` and `pnpm install` in clean ESM and CJS temporary
  fixtures outside the workspace, checks that the dependency tree contains only
  intentional runtime packages, and verifies that no runtime import or
  `require()` resolves through a workspace copy.

The entry point list is derived from `package.json` `exports` in `exports.cjs`,
so adding a new subpath is covered automatically once it ships in the build.

The suite runs in its own CI job across the supported Node versions.
