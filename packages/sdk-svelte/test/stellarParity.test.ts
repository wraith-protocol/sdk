import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StoreHarness from './StoreHarness.svelte';
import {
  useStellarAnnouncementScan,
  useStellarBalance,
  useStellarName,
  useStellarSendStealthPayment,
  useStellarStealthKeys,
} from '../src/index.js';
import { InvalidNameError, RPCAbortedError, WalletWrongNetworkError } from '@wraith-protocol/sdk';
import {
  buildStealthPayment,
  fetchAnnouncementsStream,
  resolveStellarName,
} from '@wraith-protocol/sdk/chains/stellar';

vi.mock('@wraith-protocol/sdk/chains/stellar', () => ({
  META_ADDRESS_PREFIX: 'st:xlm:',
  deriveStealthKeys: vi.fn(() => ({ marker: 'generated' })),
  generateStealthAddress: vi.fn(),
  checkStealthAddress: vi.fn(),
  scanAnnouncements: vi.fn(),
  deriveStealthPrivateScalar: vi.fn(),
  encodeStealthMetaAddress: vi.fn(),
  decodeStealthMetaAddress: vi.fn(),
  fetchAnnouncements: vi.fn(),
  fetchAnnouncementsStream: vi.fn(),
  buildStealthPayment: vi.fn(),
  resolveStellarName: vi.fn(),
  getDeployment: vi.fn(() => ({
    horizonUrl: 'https://horizon.test',
    sorobanUrl: 'https://soroban.test',
    contracts: { announcer: 'announcer', names: 'names' },
  })),
}));

vi.mock('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: vi.fn().mockImplementation(() => ({
      loadAccount: vi.fn().mockResolvedValue({
        balances: [{ asset_type: 'native', balance: '10.5' }],
      }),
    })),
  },
}));

describe('Stellar store parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches the React key primitive and notifies the rendered subscriber', async () => {
    const state = useStellarStealthKeys();
    expect(state.keys).toBeDefined();
    expect(state.generate).toBeTypeOf('function');

    render(StoreHarness, {
      props: {
        value: state.keys,
        run: () => state.generate(new Uint8Array([1, 2, 3])),
      },
    });

    expect(screen.getByTestId('value').textContent).toContain('null');
    await fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(screen.getByTestId('value').textContent).toContain('generated');
  });

  it('scans announcements and updates scanning and announcement stores', async () => {
    vi.mocked(fetchAnnouncementsStream).mockImplementation(async function* () {
      await Promise.resolve();
      yield { stealthAddress: 'GSTEALTH' } as never;
    });
    const state = useStellarAnnouncementScan();

    render(StoreHarness, {
      props: {
        value: state.announcements,
        run: () => state.scan({ fromLedger: 10 }),
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByTestId('value').textContent).toContain('GSTEALTH'));
    expect(get(state.scanning)).toBe(false);
    expect(get(state.error)).toBeNull();
  });

  it('exposes building state while a payment is being built', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(buildStealthPayment).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
    );
    const state = useStellarSendStealthPayment();

    const pending = state.build({} as never);
    expect(get(state.building)).toBe(true);
    finish({ transaction: 'built' });
    await expect(pending).resolves.toEqual({ transaction: 'built' });
    expect(get(state.building)).toBe(false);
  });

  it('loads the native Stellar balance reactively', async () => {
    const state = useStellarBalance('GACCOUNT', 'https://horizon.test');
    render(StoreHarness, { props: { value: state.balance } });

    await waitFor(() => expect(screen.getByTestId('value').textContent).toContain('10.5'));
    expect(get(state.loading)).toBe(false);
  });

  it('matches the React name primitive shape when idle', () => {
    const state = useStellarName(undefined);

    expect(get(state.address)).toBeNull();
    expect(get(state.loading)).toBe(false);
    expect(get(state.error)).toBeNull();
    expect(resolveStellarName).not.toHaveBeenCalled();
  });

  it('resolves found and missing names through resolveStellarName', async () => {
    const meta = `st:xlm:${'b'.repeat(128)}`;
    vi.mocked(resolveStellarName).mockResolvedValueOnce(meta).mockResolvedValueOnce(null);

    const state = useStellarName('alice.wraith', 'testnet');
    await waitFor(() => expect(get(state.address)).toBe(meta));
    expect(get(state.loading)).toBe(false);
    expect(get(state.error)).toBeNull();

    await state.resolve('missing.wraith', 'testnet');
    expect(get(state.address)).toBeNull();
    expect(get(state.loading)).toBe(false);
    expect(get(state.error)).toBeNull();
  });

  it('surfaces typed errors for malformed, wrong-network, and aborted lookups and supports abort()', async () => {
    const malformedErr = new InvalidNameError('ab', 'Too short');
    vi.mocked(resolveStellarName).mockRejectedValueOnce(malformedErr);

    const state = useStellarName('ab', 'testnet');
    await waitFor(() => expect(get(state.error)).toBe(malformedErr));
    expect(get(state.loading)).toBe(false);

    const wrongNetErr = new WalletWrongNetworkError({
      chain: 'stellar',
      expectedNetwork: 'testnet',
      actualNetwork: 'mainnet',
    });
    vi.mocked(resolveStellarName).mockRejectedValueOnce(wrongNetErr);
    await state.resolve('alice.wraith', 'mainnet');
    expect(get(state.error)).toBe(wrongNetErr);

    const abortedErr = new RPCAbortedError('https://soroban-testnet.stellar.org');
    vi.mocked(resolveStellarName).mockRejectedValueOnce(abortedErr);
    const controller = new AbortController();
    controller.abort();
    await state.resolve('alice.wraith', 'testnet', { signal: controller.signal });
    expect(get(state.error)).toBe(abortedErr);

    let capturedSignal: AbortSignal | undefined;
    vi.mocked(resolveStellarName).mockImplementationOnce((_n, _c, opts) => {
      capturedSignal = opts?.signal;
      return new Promise(() => {});
    });
    void state.resolve('alice.wraith', 'testnet');
    expect(get(state.loading)).toBe(true);
    expect(capturedSignal?.aborted).toBe(false);
    state.abort();
    expect(capturedSignal?.aborted).toBe(true);
    expect(get(state.loading)).toBe(false);
  });
});
