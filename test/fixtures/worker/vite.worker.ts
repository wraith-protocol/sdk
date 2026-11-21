import { exposeScannerWorker, type ScannerWorkerScope } from '@wraith-protocol/sdk/scanner/worker';

/**
 * Static worker entry used by the Vite fixture.
 *
 * Vite bundles this module into a real worker file because `vite.main.ts`
 * references it through `new URL(..., import.meta.url)`. No blob wrapper or
 * `eval` transform is involved, so a CSP that blocks both still works.
 */
exposeScannerWorker(self as unknown as ScannerWorkerScope);
