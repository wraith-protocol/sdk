import { exposeScannerWorker, type ScannerWorkerScope } from '@wraith-protocol/sdk/scanner/worker';

/**
 * Static worker entry used by the Next.js fixture.
 *
 * Next.js emits this module as a separate worker chunk from the static
 * `new URL(..., import.meta.url)` reference in `next.main.ts`.
 */
exposeScannerWorker(self as unknown as ScannerWorkerScope);
