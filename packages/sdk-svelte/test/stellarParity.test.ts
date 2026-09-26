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
import { buildStealthPayment, fetchAnnouncementsStream } from '@wraith-protocol/sdk/chains/stellar';

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

  it('matches the React name primitive shape', () => {
    const state = useStellarName(undefined);

    expect(get(state.address)).toBeNull();
    expect(get(state.loading)).toBe(false);
    expect(get(state.error)).toBeNull();
  });
});
