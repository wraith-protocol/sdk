// Executable standards-only browser Web Worker fixture.
// Runs in an isolated Worker scope with WinterCG / Web Worker globals only
// (no window, document, indexedDB, Buffer, process, fs, or Node crypto).

import { runEdgeSmokeSuite } from './suite.mjs';

self.onmessage = async (event) => {
  if (event?.data?.type !== 'run') return;
  try {
    const summary = await runEdgeSmokeSuite('browser-worker');
    self.postMessage({ ok: true, summary });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
};
