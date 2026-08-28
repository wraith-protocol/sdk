import { describe, expect, test } from 'vitest';
import { applyTransform, loadFixture, loadTransform, normalize } from './helpers.js';

const transform = loadTransform('v1', 'install-react-native-polyfills.cjs');

describe('install-react-native-polyfills', () => {
  test('inserts the import and startup call in a React Native entry file', () => {
    const input = loadFixture('install-react-native-polyfills', 'input.tsx');
    const expected = loadFixture('install-react-native-polyfills', 'output.tsx');

    const actual = applyTransform(transform, input);

    expect(normalize(actual)).toBe(normalize(expected));
  });

  test('is idempotent: running the already-migrated output again is a no-op', () => {
    const alreadyMigrated = loadFixture('install-react-native-polyfills', 'output.tsx');

    const actual = applyTransform(transform, alreadyMigrated);

    expect(normalize(actual)).toBe(normalize(alreadyMigrated));
  });

  test('merges into an existing @wraith-protocol/sdk import instead of duplicating it', () => {
    const input = `import { AppRegistry } from 'react-native';
import { ScannerPool } from '@wraith-protocol/sdk';
import App from './App';

AppRegistry.registerComponent('MyApp', () => App);
`;

    const actual = applyTransform(transform, input);

    expect(actual).toContain(
      "import { installReactNativePolyfills, ScannerPool } from '@wraith-protocol/sdk';",
    );
    expect(actual).toContain('installReactNativePolyfills();');
    // Only one import statement from the SDK root -- not duplicated.
    expect(actual.match(/from '@wraith-protocol\/sdk';/g)).toHaveLength(1);
  });

  test('leaves non-React-Native files untouched', () => {
    const input = `import { scanAnnouncements } from '@wraith-protocol/sdk/chains/stellar';

export function scan() {
  return scanAnnouncements([], new Uint8Array(), new Uint8Array(), 0n);
}
`;

    const actual = applyTransform(transform, input);

    expect(actual).toBe(input);
  });

  test('leaves React-Native files that do not import the SDK untouched', () => {
    const input = `import { View } from 'react-native';

export function Empty() {
  return null;
}
`;

    const actual = applyTransform(transform, input);

    expect(actual).toBe(input);
  });
});
