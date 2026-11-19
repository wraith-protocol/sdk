import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const target = resolve(process.argv[2]);

for (const key of [
  'Buffer',
  'process',
  'global',
  'require',
  'module',
  'setImmediate',
  'clearImmediate',
]) {
  try {
    delete globalThis[key];
  } catch {}
}

const posted = [];
globalThis.self = {
  onmessage: null,
  postMessage(message) {
    posted.push(message);
  },
};

const module = await import(pathToFileURL(target).href);
const report = await module.run();

console.log(JSON.stringify(report));
if (!report?.ok) {
  throw new Error(report?.error ?? 'edge smoke fixture did not return a report');
}
