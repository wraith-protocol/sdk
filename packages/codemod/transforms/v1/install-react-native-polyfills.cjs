/**
 * Transform: install-react-native-polyfills
 *
 * Migrates the React Native breaking change documented in MIGRATING.md
 * (1.5.0+): polyfills are no longer auto-installed, so React Native apps
 * must call `installReactNativePolyfills()` once at startup, before any
 * @wraith-protocol/sdk crypto imports are used.
 *
 * Heuristic: a file is treated as a React Native entry point if it imports
 * from 'react-native' AND imports from '@wraith-protocol/sdk' (root or a
 * chain subpath). If so, this transform:
 *
 *   1. Ensures `installReactNativePolyfills` is imported from
 *      '@wraith-protocol/sdk' (merged into an existing root import if one
 *      exists).
 *   2. Inserts `installReactNativePolyfills();` as the first statement
 *      after the file's import block, if no call to it already exists
 *      anywhere in the file.
 *
 * Idempotent: if a call to installReactNativePolyfills() is already present
 * anywhere in the file, the transform is a no-op on subsequent runs.
 */

'use strict';

const SDK_ROOT_SOURCE = '@wraith-protocol/sdk';
const POLYFILL_FN = 'installReactNativePolyfills';

module.exports = function transform(fileInfo, api, options) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  const printOptions = options.printOptions || { quote: 'single' };

  const importsReactNative =
    root
      .find(j.ImportDeclaration)
      .filter((p) => p.node.source.value === 'react-native')
      .size() > 0;

  const importsSdk =
    root
      .find(j.ImportDeclaration)
      .filter(
        (p) =>
          typeof p.node.source.value === 'string' &&
          p.node.source.value.startsWith(SDK_ROOT_SOURCE),
      )
      .size() > 0;

  if (!importsReactNative || !importsSdk) {
    return fileInfo.source;
  }

  const alreadyCalled =
    root
      .find(j.CallExpression, {
        callee: { type: 'Identifier', name: POLYFILL_FN },
      })
      .size() > 0;

  if (alreadyCalled) {
    return fileInfo.source;
  }

  ensureNamedImport(j, root, SDK_ROOT_SOURCE, POLYFILL_FN);
  insertCallAfterImports(j, root, POLYFILL_FN);

  return root.toSource(printOptions);
};

function ensureNamedImport(j, root, source, name) {
  const existing = root.find(j.ImportDeclaration).filter((p) => p.node.source.value === source);

  if (existing.size() > 0) {
    const decl = existing.paths()[0].node;
    const hasIt = decl.specifiers.some(
      (s) => s.type === 'ImportSpecifier' && s.imported.name === name,
    );
    if (!hasIt) {
      decl.specifiers.unshift(j.importSpecifier(j.identifier(name)));
    }
    return;
  }

  const newImport = j.importDeclaration([j.importSpecifier(j.identifier(name))], j.literal(source));
  const body = root.get().node.program.body;
  const lastImportIndex = body.reduce(
    (acc, node, index) => (node.type === 'ImportDeclaration' ? index : acc),
    -1,
  );
  body.splice(lastImportIndex + 1, 0, newImport);
}

function insertCallAfterImports(j, root, name) {
  const body = root.get().node.program.body;
  const lastImportIndex = body.reduce(
    (acc, node, index) => (node.type === 'ImportDeclaration' ? index : acc),
    -1,
  );
  const callStatement = j.expressionStatement(j.callExpression(j.identifier(name), []));
  body.splice(lastImportIndex + 1, 0, callStatement);
}
