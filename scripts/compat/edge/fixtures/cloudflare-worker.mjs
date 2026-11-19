import { runEdgeSmokeFlow, serializeFlowError } from '../smoke-flow.mjs';

const RUNTIME = 'cloudflare-worker';

export async function run() {
  return runEdgeSmokeFlow(RUNTIME).catch((error) => serializeFlowError(RUNTIME, error));
}

export default {
  async fetch() {
    const report = await run();
    return new Response(JSON.stringify(report), {
      status: report.ok ? 200 : 500,
      headers: { 'content-type': 'application/json' },
    });
  },
};
