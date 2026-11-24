// Executable Deno edge fixture.
// Strips Deno's npm-compatibility globals (`Buffer`, `process`) before
// importing `@wraith-protocol/sdk` subpaths and runs with zero network or env
// permissions.

delete globalThis.Buffer;
delete globalThis.process;

const { runEdgeSmokeSuite } = await import('./suite.mjs');
const summary = await runEdgeSmokeSuite('deno');
console.log(`wraith-edge-result ${JSON.stringify(summary)}`);
