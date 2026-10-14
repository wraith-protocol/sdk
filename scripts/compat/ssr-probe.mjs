// Child process for verify-ssr-imports.mjs: imports one framework companion the
// way a server does, then renders or instantiates its minimal SSR path.
//
// verify-ssr-imports.mjs copies this file next to the bundled companion, inside
// that package's node_modules, so bare imports such as `react-dom/server` or
// `svelte/server` resolve from the companion package exactly as they would in
// an app's server build.
//
// Usage: node ssr-probe.mjs <scenario> <authored-paths-json>
//
// The last stdout line is `RESULT_PREFIX` followed by a JSON report.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RESULT_PREFIX = 'wraith-ssr-result ';
const MARKER = 'wraith-ssr-smoke';

// Globals that exist in a browser but not on a server, plus browser crypto.
// Node does ship `crypto` and (from 21) `navigator`, but a companion that reads
// them at import time still breaks on runtimes without them, so they count too.
const BROWSER_GLOBALS = [
  'window',
  'self',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'crypto',
];

const [scenarioName, authoredJson] = process.argv.slice(2);
const authored = JSON.parse(authoredJson);
const probeFile = fileURLToPath(import.meta.url);

function message(error) {
  return error instanceof Error ? error.message.split('\n')[0] : String(error);
}

// --- Import-time guard -------------------------------------------------------
//
// Every browser global becomes a getter for the duration of the import. A read
// whose immediate caller is code this repo authored (the companion source or the
// core package's dist/) is recorded and throws. A read from a third-party
// dependency gets the real value, so a framework's own `typeof window` feature
// check behaves exactly as it does on a server.

const accesses = [];
const originals = new Map();

function callerFrame() {
  const frames = (new Error().stack ?? '').split('\n').slice(1);
  return frames.find((frame) => !frame.includes(probeFile)) ?? '';
}

function isAuthored(frame) {
  return authored.some((path) => frame.includes(path));
}

for (const name of BROWSER_GLOBALS) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  originals.set(name, original);
  let current = original?.get ? original.get.call(globalThis) : original?.value;
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      const frame = callerFrame();
      if (isAuthored(frame)) {
        const at = frame.trim().replace(/^at\s+/, '');
        accesses.push(`${name} at ${at}`);
        throw new ReferenceError(`${name} was read at import time on the server (${at})`);
      }
      return current;
    },
    set(value) {
      current = value;
    },
  });
}

function releaseGuard() {
  for (const [name, original] of originals) {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete globalThis[name];
  }
}

// --- Minimal SSR paths -------------------------------------------------------
//
// Each scenario calls every exported hook, composable or primitive the way a
// server render would (no network: empty inputs only) and returns the markup.

const SCENARIOS = {
  async react(sdk) {
    const { createElement } = (await import('react')).default;
    const { renderToString } = (await import('react-dom/server')).default;
    function Probe() {
      const keys = sdk.useStellarStealthKeys();
      const payment = sdk.useStellarSendStealthPayment();
      const balance = sdk.useStellarBalance('');
      const name = sdk.useStellarName(undefined);
      const scanner = sdk.useScanner();
      return createElement(
        'output',
        null,
        `${MARKER} keys=${keys.keys} building=${payment.building} balance=${balance.balance} ` +
          `name=${name.address} scanning=${scanner.scanning} platform=${sdk.getPlatform().name}`,
      );
    }
    return renderToString(createElement(Probe));
  },

  async vue(sdk) {
    const { createSSRApp, h } = await import('vue');
    const { renderToString } = await import('vue/server-renderer');
    const app = createSSRApp({
      setup() {
        const wraith = sdk.useWraith();
        sdk.useStellarStealthKeys();
        sdk.useEvmStealthKeys();
        sdk.useSolanaStealthKeys();
        sdk.useMetaAddress();
        const meta = sdk.useStealthMetaAddress();
        const keys = sdk.useStealthKeys('evm');
        const scanner = sdk.useScanner('evm');
        const activity = sdk.useActivity();
        return () =>
          h(
            'output',
            `${MARKER} chain=${meta.chain.value} keys=${keys.keys.value} ` +
              `scanning=${scanner.scanning.value} events=${activity.events.value.length} ` +
              `client=${wraith.client.value}`,
          );
      },
    });
    return renderToString(app);
  },

  // The component imports ./companion.mjs itself: the same module instance the
  // probe already loaded under the guard.
  async svelte() {
    const { compile } = await import('svelte/compiler');
    const { render } = await import('svelte/server');
    const source = `<script>
  import * as sdk from './companion.mjs';
  const wraith = sdk.useWraith();
  sdk.useStellarStealthKeys();
  sdk.useStellarAnnouncementScan();
  sdk.useStellarSendStealthPayment();
  sdk.useStellarBalance('');
  sdk.useStellarName(undefined);
  sdk.useEvmStealthKeys();
  sdk.useSolanaStealthKeys();
  const meta = sdk.useStealthMetaAddress();
  const chain = meta.chain;
  const client = wraith.client;
</script>

<output>${MARKER} chain={$chain} client={$client}</output>
`;
    const { js } = compile(source, { generate: 'server', filename: 'SsrSmoke.svelte' });
    const file = new URL('./SsrSmoke.svelte.mjs', import.meta.url);
    writeFileSync(file, js.code);
    const { default: Component } = await import(file.href);
    return render(Component).body;
  },

  async solid(sdk) {
    const { renderToString, ssr, escape } = await import('solid-js/web');
    return renderToString(() => {
      const keys = sdk.createStealthKeys();
      const scanner = sdk.createScanner();
      const meta = sdk.createMetaAddress();
      const activity = sdk.createActivity();
      return ssr(
        ['<output>', '</output>'],
        escape(
          `${MARKER} chain=${meta.chain()} keys=${keys.keys()} ` +
            `scanning=${scanner.scanning()} client=${activity.client()}`,
        ),
      );
    });
  },

  // Not a UI framework: the server path is constructing the client.
  async agent(sdk) {
    const client = new sdk.Wraith({ apiKey: 'wraith_ssr_smoke' });
    const agent = client.agent('ssr-smoke');
    if (!(agent instanceof sdk.WraithAgent))
      throw new Error('agent() did not return a WraithAgent');
    return `${MARKER} chain=${sdk.Chain.Stellar}`;
  },
};

// --- Run ---------------------------------------------------------------------

const result = {
  imported: false,
  importError: null,
  browserGlobals: accesses,
  html: null,
  ssrError: null,
};

let companion = null;
try {
  companion = await import('./companion.mjs');
  result.imported = true;
} catch (error) {
  result.importError = message(error);
}
releaseGuard();

if (companion) {
  try {
    const scenario = SCENARIOS[scenarioName];
    if (!scenario) throw new Error(`no SSR scenario named "${scenarioName}"`);
    const html = await scenario(companion);
    if (typeof html !== 'string' || !html.includes(MARKER)) {
      throw new Error(`rendered output is missing the "${MARKER}" marker: ${String(html)}`);
    }
    result.html = html;
  } catch (error) {
    result.ssrError = message(error);
  }
}

console.log(`${RESULT_PREFIX}${JSON.stringify(result)}`);
// Pending timers from a primitive (none are expected with empty inputs) must
// not keep the probe alive.
process.exit(0);
