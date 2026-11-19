import { runEdgeSmokeFlow, serializeFlowError } from '../smoke-flow.mjs';

const RUNTIME = 'browser-worker';

let pending;
const result = new Promise((resolve) => {
  pending = resolve;
});

self.onmessage = async () => {
  const report = await runEdgeSmokeFlow(RUNTIME).catch((error) =>
    serializeFlowError(RUNTIME, error),
  );
  pending(report);
  self.postMessage(report);
};

export async function run() {
  self.onmessage({ data: 'run' });
  return result;
}
