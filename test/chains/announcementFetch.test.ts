import { describe, expect, test, vi } from 'vitest';
import { collectAnnouncementPages } from '../../src/chains/announcementFetch';
import { AnnouncementBudgetExceededError } from '../../src/errors';

const records = [1, 2, 3, 4, 5];

function pagedSource(total: number) {
  return vi.fn(async (cursor: string | undefined, limit: number) => {
    const start = cursor === undefined ? 0 : Number(cursor);
    const announcements = records.slice(start, start + limit);
    const hasMore = start + announcements.length < total;
    return {
      announcements,
      cursor: hasMore ? String(start + announcements.length) : undefined,
      hasMore,
    };
  });
}

describe('collectAnnouncementPages item budget', () => {
  test('resumes at the consumed boundary without losing or duplicating records', async () => {
    const fetchPage = pagedSource(records.length);

    const error = await collectAnnouncementPages(
      'test',
      { pageSize: 3, maxItems: 2 },
      fetchPage,
    ).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AnnouncementBudgetExceededError);
    const budgetError = error as AnnouncementBudgetExceededError;
    expect(fetchPage).toHaveBeenCalledWith(undefined, 2);
    expect(budgetError.partial).toEqual([1, 2]);
    expect(budgetError.cursor).toBe('2');

    const rest = await collectAnnouncementPages(
      'test',
      { pageSize: 3, cursor: budgetError.cursor },
      fetchPage,
    );

    expect([...budgetError.partial, ...rest.announcements]).toEqual(records);
  });

  test('keeps the page-start cursor when a provider ignores the request limit', async () => {
    const fetchPage = vi.fn(async (cursor: string | undefined) => {
      const start = cursor === undefined ? 0 : Number(cursor);
      const announcements = records.slice(start, start + 3);
      const hasMore = start + announcements.length < records.length;
      return {
        announcements,
        cursor: hasMore ? String(start + announcements.length) : undefined,
        hasMore,
      };
    });

    const error = await collectAnnouncementPages('test', { maxItems: 2 }, fetchPage).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(AnnouncementBudgetExceededError);
    const budgetError = error as AnnouncementBudgetExceededError;
    expect(budgetError.partial).toEqual([1, 2]);
    expect(budgetError.cursor).toBeUndefined();
  });
});
