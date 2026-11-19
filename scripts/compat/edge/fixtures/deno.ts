import { runEdgeSmokeFlow, serializeFlowError } from '../smoke-flow.mjs';

const RUNTIME = 'deno';

const report = await runEdgeSmokeFlow(RUNTIME).catch((error) => serializeFlowError(RUNTIME, error));
console.log(JSON.stringify(report));
if (!report.ok) {
  throw new Error(report.error);
}
