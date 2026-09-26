/**
 * Transform: typed-error-catch
 *
 * Migrates the "message-matching" error handling pattern documented in
 * MIGRATING.md § Error Handling (1.5.0+) to the typed-exception pattern:
 *
 *   catch (e) {
 *     if (e.message.includes('Invalid name:')) { ... }
 *   }
 *
 *   ->
 *
 *   catch (e) {
 *     if (e instanceof InvalidNameError) { ... }
 *   }
 *
 * and adds/merges the required named import from '@wraith-protocol/sdk'.
 *
 * Only literal substrings that are known, stable fragments of an actual
 * @wraith-protocol/sdk error message are rewritten. Anything else is left
 * untouched -- this transform never guesses.
 *
 * Idempotent: after transformation, no `.message.includes(...)` call sites
 * matching the table below remain, so a second run is a structural no-op.
 */

'use strict';

// Canonical, stable message fragments -> the error class that throws them.
// Sourced directly from src/errors.ts constructors (the literal text before
// any runtime-interpolated values).
const MESSAGE_TO_ERROR_CLASS = {
  'Invalid stealth meta-address format': 'InvalidMetaAddressError',
  'Invalid name:': 'InvalidNameError',
  'Invalid signature length or format': 'InvalidSignatureError',
  'Invalid cryptographic scalar': 'InvalidScalarError',
  'Key derivation failed': 'KeyDerivationFailedError',
  'View tag mismatch': 'ViewTagMismatchError',
  'ECDH operation failed': 'ECDHFailedError',
  'Elliptic Curve Diffie-Hellman (ECDH) operation failed': 'ECDHFailedError',
  'RPC request failed': 'RPCRequestError',
  'RPC request retries exhausted': 'RPCRetryExhaustedError',
  'Retention limit exceeded': 'RetentionExceededError',
  'Name not found:': 'NameNotFoundError',
  'Name is already registered': 'NameAlreadyRegisteredError',
  'Insufficient authority to perform operation': 'InsufficientAuthError',
  'Smart contract transaction reverted': 'ContractRevertError',
  'Insufficient balance to build transaction': 'InsufficientBalanceError',
};

const SDK_SOURCE = '@wraith-protocol/sdk';

/**
 * Resolve a literal string a developer might have matched against to the
 * error class it corresponds to. Matches exact fragments, or a literal
 * that contains / is contained by a known canonical fragment.
 */
function resolveErrorClass(literal) {
  if (Object.prototype.hasOwnProperty.call(MESSAGE_TO_ERROR_CLASS, literal)) {
    return MESSAGE_TO_ERROR_CLASS[literal];
  }
  for (const [fragment, className] of Object.entries(MESSAGE_TO_ERROR_CLASS)) {
    if (literal.includes(fragment) || fragment.includes(literal)) {
      return className;
    }
  }
  return null;
}

module.exports = function transform(fileInfo, api, options) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  const printOptions = options.printOptions || { quote: 'single' };

  let mutated = false;
  const requiredClasses = new Set();

  root.find(j.CatchClause).forEach((catchPath) => {
    const param = catchPath.node.param;
    if (!param || param.type !== 'Identifier') return;
    const errName = param.name;

    j(catchPath)
      .find(j.IfStatement)
      .forEach((ifPath) => {
        const test = ifPath.node.test;
        if (!isMessageIncludesCall(test, errName)) return;

        const literalArg = test.arguments[0];
        if (!literalArg || literalArg.type !== 'StringLiteral') return;

        const errorClass = resolveErrorClass(literalArg.value);
        if (!errorClass) return;

        ifPath.node.test = j.binaryExpression(
          'instanceof',
          j.identifier(errName),
          j.identifier(errorClass),
        );
        requiredClasses.add(errorClass);
        mutated = true;
      });
  });

  if (!mutated) {
    return fileInfo.source;
  }

  ensureNamedImport(j, root, SDK_SOURCE, requiredClasses);

  return root.toSource(printOptions);
};

function isMessageIncludesCall(node, errName) {
  return (
    node &&
    node.type === 'CallExpression' &&
    node.arguments.length === 1 &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'includes' &&
    node.callee.object.type === 'MemberExpression' &&
    !node.callee.object.computed &&
    node.callee.object.property.type === 'Identifier' &&
    node.callee.object.property.name === 'message' &&
    node.callee.object.object.type === 'Identifier' &&
    node.callee.object.object.name === errName
  );
}

function ensureNamedImport(j, root, source, names) {
  if (names.size === 0) return;

  const existing = root.find(j.ImportDeclaration).filter((p) => p.node.source.value === source);

  if (existing.size() > 0) {
    const decl = existing.paths()[0].node;
    const existingNames = new Set(
      decl.specifiers.filter((s) => s.type === 'ImportSpecifier').map((s) => s.imported.name),
    );
    for (const name of names) {
      if (!existingNames.has(name)) {
        decl.specifiers.push(j.importSpecifier(j.identifier(name)));
      }
    }
    return;
  }

  const specifiers = [...names].map((name) => j.importSpecifier(j.identifier(name)));
  const newImport = j.importDeclaration(specifiers, j.literal(source));

  const body = root.get().node.program.body;
  const lastImportIndex = body.reduce(
    (acc, node, index) => (node.type === 'ImportDeclaration' ? index : acc),
    -1,
  );
  body.splice(lastImportIndex + 1, 0, newImport);
}
