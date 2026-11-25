import { createWorkerScanner } from '@wraith-protocol/sdk';

const worker = new Worker('./plain.worker.js', { type: 'module' });

export const scanner = createWorkerScanner(worker);
