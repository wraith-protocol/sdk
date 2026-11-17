// Executable Bun edge fixture.
// Strips Bun's `Buffer` global before importing `@wraith-protocol/sdk` subpaths
// so byte operations rely exclusively on standard `Uint8Array`, `TextEncoder`,
// `TextDecoder`, and Web Crypto without Node polyfills.

delete globalThis.Buffer;

const { runEdgeSmokeSuite } = await import('./suite.mjs');
const summary = await runEdgeSmokeSuite('bun');
console.log(`wraith-edge-result ${JSON.stringify(summary)}`);
