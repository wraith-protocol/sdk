import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../..');

const frameworkPackages = [
  { name: 'react', index: 'packages/sdk-react/src/index.ts', scanner: 'hooks.ts' },
  { name: 'vue', index: 'packages/sdk-vue/src/index.ts', scanner: 'composables/useScanner.ts' },
  {
    name: 'svelte',
    index: 'packages/sdk-svelte/src/index.ts',
    scanner: 'primitives/useStellarAnnouncementScan.ts',
  },
  { name: 'solid', index: 'packages/sdk-solid/src/index.ts', scanner: 'primitives/createScanner.ts' },
] as const;

function source(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('framework package conformance surface', () => {
  for (const framework of frameworkPackages) {
    test(`${framework.name} has a public entry point and cancellation-aware scanner/activity surface`, () => {
      const index = source(framework.index);
      const scanner = source(`packages/sdk-${framework.name}/src/${framework.scanner}`);

      expect(index).toMatch(/export/);
      expect(scanner).toMatch(/AbortSignal|AbortController/);
      expect(scanner).toMatch(/error/i);
      expect(scanner).toMatch(/chain/i);
    });
  }

  test('agent package preserves typed error propagation and response validation', () => {
    const index = source('packages/sdk-agent/src/index.ts');
    const client = source('packages/sdk-agent/src/client.ts');

    expect(index).toMatch(/AgentResponseError/);
    expect(index).toMatch(/RPCRequestError/);
    expect(client).toMatch(/validateAgentStatus/);
    expect(client).toMatch(/validatePayment/);
    expect(client).toMatch(/throw/);
  });
});
