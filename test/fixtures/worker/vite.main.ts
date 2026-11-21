import { createWorkerScanner } from '@wraith-protocol/sdk';

const worker = new Worker(new URL('./vite.worker.ts', import.meta.url), {
  type: 'module',
});

export const scanner = createWorkerScanner(worker);
