import { describe, expect, it } from 'vitest';

import {
  addMonths,
  addDays,
  daysInMonth,
  financialYearOf,
  financialYearBounds,
  formatPeriodLong,
  gstQuarterOf,
  isLeapYear,
  isWithinFinancialYear,
  monthPeriodOf,
  periodBounds,
  todayIst,
} from '@/lib/dates';

describe('month-end anchoring', () => {
  it('clamps a 31st anchor to short months and returns to the 31st', () => {
    // This is the exact behaviour the product promises for monthly schedules.
    let d = '2026-01-31';
    const seen = [d];
    for (let i = 0; i < 6; i += 1) {
      d = addMonths(d, 1, 31);
      seen.push(d);
    }
    expect(seen).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
    ]);
  });

  it('uses 29 February in a leap year', () => {
    expect(addMonths('2024-01-31', 1, 31)).toBe('2024-02-29');
    expect(addMonths('2023-01-31', 1, 31)).toBe('2023-02-28');
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2024, 2)).toBe(29);
  });

  it('without an anchor, degrades to plain month addition', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    // ...and then cannot recover the 31st, which is why schedules pass an anchor.
    expect(addMonths('2026-02-28', 1)).toBe('2026-03-28');
  });
});

describe('financial years', () => {
  it('runs April to March', () => {
    expect(financialYearOf('2026-04-01')).toBe('2026-27');
    expect(financialYearOf('2027-03-31')).toBe('2026-27');
    expect(financialYearOf('2026-03-31')).toBe('2025-26');
    expect(financialYearBounds('2026-27')).toEqual({ start: '2026-04-01', end: '2027-03-31' });
  });

  it('knows whether a date belongs to a year', () => {
    expect(isWithinFinancialYear('2026-09-24', '2026-27')).toBe(true);
    expect(isWithinFinancialYear('2026-02-24', '2026-27')).toBe(false);
  });
});

describe('periods and quarters', () => {
  it('derives month periods and their bounds', () => {
    expect(monthPeriodOf('2026-09-24')).toBe('2026-09');
    expect(periodBounds('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(periodBounds('2024-02')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(formatPeriodLong('2026-09')).toBe('September 2026');
  });

  it('maps months to GST quarters within the financial year', () => {
    expect(gstQuarterOf('2026-09').months).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(gstQuarterOf('2026-04').months).toEqual(['2026-04', '2026-05', '2026-06']);
    // January-March belongs to the PREVIOUS financial year's fourth quarter.
    expect(gstQuarterOf('2026-02').months).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(gstQuarterOf('2026-02').label).toContain('2025-26');
  });
});

describe('IST', () => {
  it('returns a well-formed civil date', () => {
    expect(todayIst()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('resolves the date in Kolkata, not UTC', () => {
    // 19:00 UTC on 24 Sep is already 00:30 on 25 Sep in Kolkata.
    expect(todayIst(new Date('2026-09-24T19:00:00Z'))).toBe('2026-09-25');
    expect(todayIst(new Date('2026-09-24T18:00:00Z'))).toBe('2026-09-24');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
