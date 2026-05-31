import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStellarAnnouncementScan } from '../src/useStellarAnnouncementScan';
import * as stellarSdk from '@wraith-protocol/sdk/chains/stellar';
import type { StealthKeys, MatchedAnnouncement } from '@wraith-protocol/sdk/chains/stellar';

vi.mock('@wraith-protocol/sdk/chains/stellar', () => ({
  fetchAnnouncements: vi.fn(),
  scanAnnouncements: vi.fn(),
}));

describe('useStellarAnnouncementScan', () => {
  const mockKeys: StealthKeys = {
    spendingKey: new Uint8Array(32),
    spendingScalar: 123n,
    viewingKey: new Uint8Array(32),
    viewingScalar: 456n,
    spendingPubKey: new Uint8Array(32),
    viewingPubKey: new Uint8Array(32),
  };

  const mockMatches: MatchedAnnouncement[] = [
    {
      schemeId: 1,
      stealthAddress: 'GTEST...',
      caller: 'GCALLER...',
      ephemeralPubKey: '0x' + '00'.repeat(32),
      metadata: '0x00',
      stealthPrivateScalar: 789n,
      stealthPubKeyBytes: new Uint8Array(32),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not scan when keys are null', () => {
    const { result } = renderHook(() => useStellarAnnouncementScan(null));

    expect(result.current.matches).toEqual([]);
    expect(result.current.isScanning).toBe(false);
    expect(stellarSdk.fetchAnnouncements).not.toHaveBeenCalled();
  });

  it('should scan announcements on mount', async () => {
    vi.mocked(stellarSdk.fetchAnnouncements).mockResolvedValue([]);
    vi.mocked(stellarSdk.scanAnnouncements).mockReturnValue(mockMatches);

    const { result } = renderHook(() => useStellarAnnouncementScan(mockKeys));

    await waitFor(() => {
      expect(result.current.isScanning).toBe(false);
    });

    expect(result.current.matches).toEqual(mockMatches);
    expect(result.current.lastScanAt).toBeInstanceOf(Date);
    expect(stellarSdk.fetchAnnouncements).toHaveBeenCalledTimes(1);
  });

  it('should poll at specified interval', async () => {
    vi.mocked(stellarSdk.fetchAnnouncements).mockResolvedValue([]);
    vi.mocked(stellarSdk.scanAnnouncements).mockReturnValue(mockMatches);

    renderHook(() => useStellarAnnouncementScan(mockKeys, { intervalMs: 5000 }));

    await waitFor(() => {
      expect(stellarSdk.fetchAnnouncements).toHaveBeenCalledTimes(1);
    });

    // Advance time by 5 seconds
    vi.advanceTimersByTime(5000);

    await waitFor(() => {
      expect(stellarSdk.fetchAnnouncements).toHaveBeenCalledTimes(2);
    });
  });

  it('should not scan when disabled', () => {
    const { result } = renderHook(() =>
      useStellarAnnouncementScan(mockKeys, { enabled: false })
    );

    expect(result.current.isScanning).toBe(false);
    expect(stellarSdk.fetchAnnouncements).not.toHaveBeenCalled();
  });

  it('should handle scan errors', async () => {
    const error = new Error('Fetch failed');
    vi.mocked(stellarSdk.fetchAnnouncements).mockRejectedValue(error);

    const { result } = renderHook(() => useStellarAnnouncementScan(mockKeys));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error?.message).toBe('Fetch failed');
    expect(result.current.isScanning).toBe(false);
  });

  it('should support manual refetch', async () => {
    vi.mocked(stellarSdk.fetchAnnouncements).mockResolvedValue([]);
    vi.mocked(stellarSdk.scanAnnouncements).mockReturnValue(mockMatches);

    const { result } = renderHook(() => useStellarAnnouncementScan(mockKeys));

    await waitFor(() => {
      expect(stellarSdk.fetchAnnouncements).toHaveBeenCalledTimes(1);
    });

    // Manual refetch
    await result.current.refetch();

    expect(stellarSdk.fetchAnnouncements).toHaveBeenCalledTimes(2);
  });

  it('should prevent concurrent scans', async () => {
    let resolvePromise: () => void;
    const promise = new Promise<any[]>((resolve) => {
      resolvePromise = () => resolve([]);
    });

    vi.mocked(stellarSdk.fetchAnnouncements).mockReturnValue(promise);
    vi.mocked(stellarSdk.scanAnnouncements).mockReturnValue([]);

    const { result } = renderHook(() => useStellarAnnouncementScan(mockKeys));

    // Try to refetch while scanning
    result.current.refetch();
    result.current.refetch();

    resolvePromise!();

    await waitFor(() => {
      expect(result.current.isScanning).toBe(false);
    });

    // Should only have called once (initial) despite multiple refetch attempts
    expect(stellarSdk.fetchAnnouncements).toHaveBeenCalledTimes(1);
  });
});
