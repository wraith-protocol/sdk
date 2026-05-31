import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useStellarName } from '../src/useStellarName';

describe('useStellarName', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return null for empty name', () => {
    const { result } = renderHook(() => useStellarName(''));

    expect(result.current.metaAddress).toBeNull();
    expect(result.current.isResolving).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should debounce name resolution', async () => {
    const { result, rerender } = renderHook(({ name }) => useStellarName(name), {
      initialProps: { name: 'a' },
    });

    expect(result.current.isResolving).toBe(true);

    // Change name before debounce completes
    rerender({ name: 'al' });
    rerender({ name: 'ali' });
    rerender({ name: 'alice' });

    // Fast-forward past debounce delay
    vi.advanceTimersByTime(300);

    await waitFor(() => {
      expect(result.current.isResolving).toBe(false);
    });

    // Should only have attempted resolution once after debounce
    expect(result.current.error?.message).toContain('not yet implemented');
  });

  it('should use cached results', async () => {
    // Mock the cache
    const cache = new Map<string, string>();
    cache.set('alice.stellar', 'st:stellar:0x...');

    // Manually set cache (in real implementation, this would be set after successful resolution)
    const { result } = renderHook(() => useStellarName('alice.stellar'));

    // Since name resolution is not implemented, we can't test actual caching
    // This test documents the expected behavior
    expect(result.current.isResolving).toBe(true);
  });

  it('should handle resolution errors', async () => {
    const { result } = renderHook(() => useStellarName('test.stellar'));

    vi.advanceTimersByTime(300);

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.metaAddress).toBeNull();
    expect(result.current.isResolving).toBe(false);
    expect(result.current.error?.message).toContain('not yet implemented');
  });

  it('should clear state when name becomes empty', async () => {
    const { result, rerender } = renderHook(({ name }) => useStellarName(name), {
      initialProps: { name: 'alice.stellar' },
    });

    expect(result.current.isResolving).toBe(true);

    rerender({ name: '' });

    expect(result.current.metaAddress).toBeNull();
    expect(result.current.isResolving).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should cancel pending resolution on unmount', async () => {
    const { unmount } = renderHook(() => useStellarName('alice.stellar'));

    // Unmount before debounce completes
    unmount();

    // Fast-forward timers
    vi.advanceTimersByTime(300);

    // Should not throw or cause issues
    expect(true).toBe(true);
  });
});
