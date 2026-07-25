import { ref, readonly } from 'vue';
import { MultichainScannerPool } from '@wraith-protocol/sdk';
import type {
    ScanInput,
    ScanResults,
    ProgressEvent,
    MultichainScannerPoolOptions,
} from '@wraith-protocol/sdk';

export function useScanner(options?: MultichainScannerPoolOptions) {
    const results = ref<ScanResults | null>(null);
    const loading = ref(false);
    const error = ref<string | null>(null);
    const progress = ref<ProgressEvent | null>(null);

    const pool = new MultichainScannerPool(options);

    pool.on('progress', (e) => {
        progress.value = e;
    });

    async function scan(input: ScanInput, signal?: AbortSignal): Promise<ScanResults> {
        loading.value = true;
        error.value = null;
        try {
            const r = await pool.scanAll(input, signal);
            results.value = r;
            return r;
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Scan failed';
            error.value = msg;
            throw e;
        } finally {
            loading.value = false;
        }
    }

    return {
        results: readonly(results),
        loading: readonly(loading),
        error: readonly(error),
        progress: readonly(progress),
        scan,
    };
}
