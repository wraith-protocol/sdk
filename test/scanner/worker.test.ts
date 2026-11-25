import { describe, test, expect } from 'vitest';
import { runScannerWorker } from '../../src/scanner/worker-core';
import { createScannerWorkerHandler } from '../../src/scanner/worker';
import { createWorkerScanner, ScannerWorkerError } from '../../src/scanner/worker-client';
import type { ScannerWorkerEndpoint, WorkerScanner } from '../../src/scanner/worker-client';
import { SCANNER_WORKER_PROTOCOL_VERSION } from '../../src/scanner/worker-protocol';
import type {
  ScannerWorkerInput,
  ScannerWorkerRequest,
  ScannerWorkerResponse,
  ScannerWorkerScope,
} from '../../src/scanner/worker-protocol';
import { MultichainScannerPool } from '../../src/scanner-pool';
import { deriveStealthKeys as deriveEvmKeys } from '../../src/chains/evm/keys';
import { generateStealthAddress as generateEvmAddress } from '../../src/chains/evm/stealth';
import { SCHEME_ID as EVM_SCHEME_ID } from '../../src/chains/evm/constants';
import type {
  Announcement as EvmAnnouncement,
  HexString as EvmHexString,
} from '../../src/chains/evm/types';
import { deriveStealthKeys as deriveStellarKeys } from '../../src/chains/stellar/keys';
import { generateStealthAddress as generateStellarAddress } from '../../src/chains/stellar/stealth';
import { SCHEME_ID as STELLAR_SCHEME_ID } from '../../src/chains/stellar/constants';
import { bytesToHex } from '../../src/chains/stellar/utils';
import type { Announcement as StellarAnnouncement } from '../../src/chains/stellar/types';

const evmSig = ('0x' + 'aa'.repeat(32) + 'bb'.repeat(32) + '1b') as EvmHexString;
const stellarSig = new Uint8Array(64).fill(0xaa);

const evmKeys = deriveEvmKeys(evmSig);
const stellarKeys = deriveStellarKeys(stellarSig);

function evmAnnouncement(ephemeralPrivateKey: EvmHexString): EvmAnnouncement {
  const stealth = generateEvmAddress(
    evmKeys.spendingPubKey,
    evmKeys.viewingPubKey,
    ephemeralPrivateKey,
  );
  return {
    schemeId: EVM_SCHEME_ID,
    stealthAddress: stealth.stealthAddress,
    caller: ('0x' + '11'.repeat(20)) as EvmHexString,
    ephemeralPubKey: stealth.ephemeralPubKey,
    metadata: ('0x' + stealth.viewTag.toString(16).padStart(2, '0')) as EvmHexString,
  };
}

function stellarAnnouncement(seed: number): StellarAnnouncement {
  const ephemeralSeed = new Uint8Array(32).fill(seed);
  const stealth = generateStellarAddress(
    stellarKeys.spendingPubKey,
    stellarKeys.viewingPubKey,
    ephemeralSeed,
  );
  return {
    schemeId: STELLAR_SCHEME_ID,
    stealthAddress: stealth.stealthAddress,
    caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
    metadata: stealth.viewTag.toString(16).padStart(2, '0'),
  };
}

const evmFirst = evmAnnouncement(('0x' + '01'.repeat(32)) as EvmHexString);
const evmSecond = evmAnnouncement(('0x' + '02'.repeat(32)) as EvmHexString);
const evmNoise: EvmAnnouncement = { ...evmFirst, schemeId: 99n };

const stellarFirst = stellarAnnouncement(0x11);
const stellarSecond = stellarAnnouncement(0x22);
const stellarNoise: StellarAnnouncement = { ...stellarFirst, schemeId: 99 };

const evmInput = {
  announcements: [evmFirst, evmNoise, evmSecond],
  viewingKey: evmKeys.viewingKey,
  spendingPubKey: evmKeys.spendingPubKey,
  spendingKey: evmKeys.spendingKey,
};

const stellarInput = {
  announcements: [stellarFirst, stellarNoise, stellarSecond],
  viewingKey: stellarKeys.viewingKey,
  spendingPubKey: stellarKeys.spendingPubKey,
  spendingScalar: stellarKeys.spendingScalar,
};

function createScope(): {
  scope: ScannerWorkerScope;
  messages: ScannerWorkerResponse[];
} {
  let listener: ((event: MessageEvent<unknown>) => void) | undefined;
  const messages: ScannerWorkerResponse[] = [];
  return {
    scope: {
      postMessage(message) {
        messages.push(message);
      },
      addEventListener(type, next) {
        if (type === 'message') listener = next;
      },
      removeEventListener(type, next) {
        if (type === 'message' && listener === next) listener = undefined;
      },
    },
    messages,
  };
}

interface FakeEndpoint {
  endpoint: ScannerWorkerEndpoint;
  sent: ScannerWorkerRequest[];
  emit(response: ScannerWorkerResponse): void;
  listenerCount(): number;
}

function createFakeEndpoint(): FakeEndpoint {
  let listener: ((event: MessageEvent<unknown>) => void) | undefined;
  const sent: ScannerWorkerRequest[] = [];
  return {
    endpoint: {
      postMessage(message) {
        sent.push(message);
      },
      addEventListener(type, next) {
        if (type === 'message') listener = next;
      },
      removeEventListener(type, next) {
        if (type === 'message' && listener === next) listener = undefined;
      },
    },
    sent,
    emit(response) {
      listener?.({ data: response } as MessageEvent<unknown>);
    },
    listenerCount() {
      return listener ? 1 : 0;
    },
  };
}

function lastMessage(messages: ScannerWorkerResponse[]): ScannerWorkerResponse {
  const message = messages[messages.length - 1];
  if (!message) throw new Error('worker produced no messages');
  return message;
}

describe('runScannerWorker', () => {
  test('returns matches in chain and input order', async () => {
    const matches = await runScannerWorker({ evm: evmInput, stellar: stellarInput });

    expect(matches.map((match) => match.chain)).toEqual(['evm', 'evm', 'stellar', 'stellar']);
    expect(
      matches.map((match) =>
        match.chain === 'evm' || match.chain === 'stellar'
          ? match.announcement.stealthAddress
          : undefined,
      ),
    ).toEqual([
      evmFirst.stealthAddress,
      evmSecond.stealthAddress,
      stellarFirst.stealthAddress,
      stellarSecond.stealthAddress,
    ]);
  });

  test('matches the main-thread scanner for the same vectors', async () => {
    const workerMatches = await runScannerWorker({ evm: evmInput, stellar: stellarInput });
    const mainThread = await new MultichainScannerPool().scanAll({
      evm: evmInput,
      stellar: stellarInput,
    });

    const mainAddresses = [
      ...(mainThread.evm ?? []).map((match) => match.stealthAddress),
      ...(mainThread.stellar ?? []).map((match) => match.stealthAddress),
    ];
    const workerAddresses = workerMatches.map((match) =>
      match.chain === 'evm' || match.chain === 'stellar'
        ? match.announcement.stealthAddress
        : undefined,
    );

    expect(workerAddresses).toEqual(mainAddresses);
  });

  test('reports progress from zero to the total for each chain', async () => {
    const progress: Array<{ chain: string; processed: number; total: number }> = [];

    await runScannerWorker(
      { evm: evmInput, stellar: stellarInput },
      {
        progressInterval: 1,
        onProgress: (event) => progress.push(event),
      },
    );

    expect(progress[0]).toEqual({ chain: 'evm', processed: 0, total: 3 });
    expect(progress.filter((event) => event.chain === 'evm').at(-1)).toEqual({
      chain: 'evm',
      processed: 3,
      total: 3,
    });
    expect(progress.filter((event) => event.chain === 'stellar')[0]).toEqual({
      chain: 'stellar',
      processed: 0,
      total: 3,
    });
    expect(progress.at(-1)).toEqual({ chain: 'stellar', processed: 3, total: 3 });
  });

  test('accepts structured-clone copies of the input', async () => {
    const cloned = structuredClone<ScannerWorkerInput>({ evm: evmInput, stellar: stellarInput });
    const matches = await runScannerWorker(cloned);

    expect(matches).toHaveLength(4);
  });

  test('rejects invalid input with a typed error', async () => {
    await expect(
      runScannerWorker({ evm: { announcements: 'not-an-array' } } as unknown as ScannerWorkerInput),
    ).rejects.toMatchObject({ name: 'ScannerWorkerInputError' });
  });

  test('throws AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runScannerWorker({ evm: evmInput }, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('createScannerWorkerHandler', () => {
  test('posts progress and a result for a successful scan', async () => {
    const { scope, messages } = createScope();
    const handler = createScannerWorkerHandler(scope);

    await handler.handleMessage({
      version: SCANNER_WORKER_PROTOCOL_VERSION,
      type: 'start',
      requestId: 'job-1',
      input: { evm: evmInput, stellar: stellarInput },
    });

    expect(handler.activeCount).toBe(0);
    const progress = messages.filter((message) => message.type === 'progress');
    expect(progress.length).toBeGreaterThan(0);

    const terminal = lastMessage(messages);
    expect(terminal.type).toBe('result');
    if (terminal.type === 'result') {
      expect(terminal.requestId).toBe('job-1');
      expect(terminal.matches).toHaveLength(4);
    }
  });

  test('emits a cancelled failure and releases the active scan', async () => {
    const { scope, messages } = createScope();
    const handler = createScannerWorkerHandler(scope);

    const running = handler.handleMessage({
      version: SCANNER_WORKER_PROTOCOL_VERSION,
      type: 'start',
      requestId: 'job-2',
      input: { evm: evmInput, stellar: stellarInput },
    });
    await handler.handleMessage({
      version: SCANNER_WORKER_PROTOCOL_VERSION,
      type: 'cancel',
      requestId: 'job-2',
    });
    await running;

    expect(handler.activeCount).toBe(0);
    expect(lastMessage(messages)).toMatchObject({
      type: 'failure',
      requestId: 'job-2',
      failure: { code: 'cancelled' },
    });
  });

  test('rejects a malformed message with the invalid-message code', async () => {
    const { scope, messages } = createScope();
    const handler = createScannerWorkerHandler(scope);

    await handler.handleMessage({
      version: SCANNER_WORKER_PROTOCOL_VERSION,
      type: 'unknown',
      requestId: 'job-3',
    });

    expect(lastMessage(messages)).toMatchObject({
      type: 'failure',
      requestId: 'job-3',
      failure: { code: 'invalid-message' },
    });
  });

  test('rejects a request from another protocol version', async () => {
    const { scope, messages } = createScope();
    const handler = createScannerWorkerHandler(scope);

    await handler.handleMessage({
      version: SCANNER_WORKER_PROTOCOL_VERSION + 1,
      type: 'start',
      requestId: 'job-version',
      input: { evm: evmInput },
    });

    expect(lastMessage(messages)).toMatchObject({
      version: SCANNER_WORKER_PROTOCOL_VERSION,
      type: 'failure',
      requestId: 'job-version',
      failure: { code: 'version-mismatch' },
    });
    expect(handler.activeCount).toBe(0);
  });

  test('treats a missing protocol version as a mismatch', async () => {
    const { scope, messages } = createScope();
    const handler = createScannerWorkerHandler(scope);

    await handler.handleMessage({
      type: 'start',
      requestId: 'job-no-version',
      input: { evm: evmInput },
    });

    expect(lastMessage(messages)).toMatchObject({
      version: SCANNER_WORKER_PROTOCOL_VERSION,
      type: 'failure',
      requestId: 'job-no-version',
      failure: { code: 'version-mismatch' },
    });
  });

  test('rejects malformed input with the invalid-input code', async () => {
    const { scope, messages } = createScope();
    const handler = createScannerWorkerHandler(scope);

    await handler.handleMessage({
      version: SCANNER_WORKER_PROTOCOL_VERSION,
      type: 'start',
      requestId: 'job-4',
      input: { evm: { announcements: [] } },
    });

    expect(lastMessage(messages)).toMatchObject({
      type: 'failure',
      requestId: 'job-4',
      failure: { code: 'invalid-input' },
    });
  });

  test('reports a scan failure without leaking the thrown error type', async () => {
    const { scope, messages } = createScope();
    const handler = createScannerWorkerHandler(scope);

    await handler.handleMessage({
      version: SCANNER_WORKER_PROTOCOL_VERSION,
      type: 'start',
      requestId: 'job-5',
      input: {
        evm: {
          ...evmInput,
          announcements: [
            {
              ...evmFirst,
              ephemeralPubKey: ('0x' + 'zz'.repeat(33)) as EvmHexString,
            },
          ],
        },
      },
    });

    expect(lastMessage(messages)).toMatchObject({
      type: 'failure',
      requestId: 'job-5',
      failure: { code: 'scan-failed' },
    });
  });

  test('dispose aborts active work and stops handling messages', async () => {
    const { scope, messages } = createScope();
    const handler = createScannerWorkerHandler(scope);

    const running = handler.handleMessage({
      version: SCANNER_WORKER_PROTOCOL_VERSION,
      type: 'start',
      requestId: 'job-6',
      input: { evm: evmInput },
    });
    handler.dispose();
    await running;

    expect(handler.activeCount).toBe(0);
    expect(messages.every((message) => message.type === 'progress')).toBe(true);
  });
});

describe('createWorkerScanner', () => {
  test('sends a start request, forwards progress, and resolves results', async () => {
    const fake = createFakeEndpoint();
    const client = createWorkerScanner(fake.endpoint);
    const progress: unknown[] = [];

    const promise = client.scan({ evm: evmInput }, { onProgress: (event) => progress.push(event) });
    const start = fake.sent[0];
    expect(start).toMatchObject({ version: SCANNER_WORKER_PROTOCOL_VERSION, type: 'start' });

    if (start.type !== 'start') throw new Error('expected start request');
    fake.emit({
      version: SCANNER_WORKER_PROTOCOL_VERSION,
      type: 'progress',
      requestId: start.requestId,
      progress: { chain: 'evm', processed: 1, total: 3 },
    });
    fake.emit({
      version: SCANNER_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId: start.requestId,
      matches: [],
    });

    await expect(promise).resolves.toEqual([]);
    expect(progress).toEqual([{ chain: 'evm', processed: 1, total: 3 }]);
    expect(client.pendingCount).toBe(0);
  });

  test('maps a worker failure to ScannerWorkerError', async () => {
    const fake = createFakeEndpoint();
    const client = createWorkerScanner(fake.endpoint);

    const promise = client.scan({ evm: evmInput });
    const start = fake.sent[0];
    if (start.type !== 'start') throw new Error('expected start request');

    fake.emit({
      version: SCANNER_WORKER_PROTOCOL_VERSION,
      type: 'failure',
      requestId: start.requestId,
      failure: { code: 'scan-failed', message: 'boom' },
    });

    await expect(promise).rejects.toBeInstanceOf(ScannerWorkerError);
    await expect(promise).rejects.toMatchObject({ code: 'scan-failed', message: 'boom' });
  });

  test('rejects a response from another protocol version', async () => {
    const fake = createFakeEndpoint();
    const client = createWorkerScanner(fake.endpoint);

    const promise = client.scan({ evm: evmInput });
    const start = fake.sent[0];
    if (start.type !== 'start') throw new Error('expected start request');

    fake.emit({
      version: SCANNER_WORKER_PROTOCOL_VERSION + 1,
      type: 'result',
      requestId: start.requestId,
      matches: [],
    });

    await expect(promise).rejects.toMatchObject({ code: 'version-mismatch' });
    expect(client.pendingCount).toBe(0);
  });

  test('aborting sends cancel and rejects with AbortError', async () => {
    const fake = createFakeEndpoint();
    const client = createWorkerScanner(fake.endpoint);
    const controller = new AbortController();

    const promise = client.scan({ evm: evmInput }, { signal: controller.signal });
    const start = fake.sent[0];
    if (start.type !== 'start') throw new Error('expected start request');

    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(fake.sent[1]).toEqual({
      version: SCANNER_WORKER_PROTOCOL_VERSION,
      type: 'cancel',
      requestId: start.requestId,
    });
    expect(client.pendingCount).toBe(0);

    fake.emit({
      version: SCANNER_WORKER_PROTOCOL_VERSION,
      type: 'failure',
      requestId: start.requestId,
      failure: { code: 'cancelled', message: 'Scan cancelled' },
    });
  });

  test('dispose rejects pending scans and removes the message listener', async () => {
    const fake = createFakeEndpoint();
    const client = createWorkerScanner(fake.endpoint);

    const promise = client.scan({ evm: evmInput });
    client.dispose();

    await expect(promise).rejects.toMatchObject({ code: 'disposed' });
    expect(client.pendingCount).toBe(0);
    expect(fake.listenerCount()).toBe(0);
  });

  test('terminates the worker when configured', () => {
    const fake = createFakeEndpoint();
    let terminated = false;
    const client: WorkerScanner = createWorkerScanner(
      { ...fake.endpoint, terminate: () => (terminated = true) },
      { terminateOnDispose: true },
    );

    client.dispose();

    expect(terminated).toBe(true);
  });
});
