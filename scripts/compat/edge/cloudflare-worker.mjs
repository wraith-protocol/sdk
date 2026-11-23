// Executable Cloudflare Workers / Miniflare edge fixture.
// Runs inside workerd without `nodejs_compat` (no Buffer, process, fs, or Node crypto).

import { runEdgeSmokeSuite } from './suite.mjs';

export default {
  async fetch() {
    const summary = await runEdgeSmokeSuite('cloudflare-workers');
    return Response.json(summary);
  },
};
