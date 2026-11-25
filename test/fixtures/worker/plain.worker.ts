import { exposeScannerWorker, type ScannerWorkerScope } from '@wraith-protocol/sdk/scanner/worker';

/**
 * Static worker entry used by the plain fixture.
 *
 * A bundler or a plain ES module worker can load this file directly from the
 * same origin. Nothing is created from a blob URL or compiled at runtime.
 */
exposeScannerWorker(self as unknown as ScannerWorkerScope);
