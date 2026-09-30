import { describe, expect, it } from 'vitest';
import { monthBounds, monthsEnding } from '@/services/validationScorecard';

describe('validation scorecard window', () => {
  it('counts months back across a year boundary, oldest first', () => {
    expect(monthsEnding('202602', 4)).toEqual(['202511', '202512', '202601', '202602']);
  });

  it('covers a full year ending in December', () => {
    const months = monthsEnding('202512', 12);
    expect(months[0]).toBe('202501');
    expect(months).toHaveLength(12);
  });

  it('gives the first and last day of a month, including a leap February', () => {
    expect(monthBounds('202402')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(monthBounds('202512')).toEqual({ start: '2025-12-01', end: '2025-12-31' });
  });
});
