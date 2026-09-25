import { describe, expect, it } from 'vitest';

import { advance, billingPeriodFor, duePeriods, needsDateReview, nextDateAfterResume } from '@/server/services/recurrence';

const base = {
  anchorDay: 1,
  nextDraftDate: '2026-01-01',
  endDate: null,
  billingPeriodChoice: 'current-month' as const,
  skippedPeriods: [] as string[],
};

describe('advancing a schedule', () => {
  it('keeps the 31st across short months, including February', () => {
    let d = '2026-01-31';
    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      d = advance(d, 31);
      seen.push(d);
    }
    expect(seen).toEqual(['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('uses 29 February in a leap year', () => {
    expect(advance('2024-01-31', 31)).toBe('2024-02-29');
    expect(advance('2024-02-29', 31)).toBe('2024-03-31');
  });

  it('crosses the financial-year boundary without a special case', () => {
    expect(advance('2027-03-15', 15)).toBe('2027-04-15');
    expect(advance('2026-12-31', 31)).toBe('2027-01-31');
  });
});

describe('billing periods', () => {
  it('covers the current month when asked to', () => {
    expect(billingPeriodFor('2026-09-01', 'current-month')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('covers the previous month when asked to', () => {
    expect(billingPeriodFor('2026-09-01', 'previous-month')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('gets February right in a leap year', () => {
    expect(billingPeriodFor('2024-03-01', 'previous-month')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });

  it('keeps the billing period separate from the draft date', () => {
    const period = billingPeriodFor('2026-09-05', 'previous-month');
    expect(period.from).toBe('2026-08-01');
    expect(period.to).toBe('2026-08-31');
    // The draft date is in September; the supply it bills is August.
  });
});

describe('due periods and catch-up', () => {
  it('produces nothing before the first draft date', () => {
    expect(duePeriods({ ...base, nextDraftDate: '2026-10-01' }, '2026-09-25')).toHaveLength(0);
  });

  it('produces one period when exactly due', () => {
    const due = duePeriods({ ...base, nextDraftDate: '2026-09-01' }, '2026-09-01');
    expect(due).toHaveLength(1);
    expect(due[0]!.period).toBe('2026-09');
    expect(due[0]!.isCatchUp).toBe(false);
  });

  /**
   * GATE: "outage catch-up" -- a worker that was down for three months must
   * produce three separate, visible drafts, not one merged bill and not silence.
   */
  it('catches up every missed period separately after an outage', () => {
    const due = duePeriods({ ...base, nextDraftDate: '2026-06-01' }, '2026-09-15');
    expect(due.map((d) => d.period)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09']);
    expect(due.slice(0, 3).every((d) => d.isCatchUp)).toBe(true);
    // Each keeps its own billing period -- August's draft bills August.
    expect(due[2]!.billingPeriod).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('never produces a period the owner deliberately skipped', () => {
    const due = duePeriods({ ...base, nextDraftDate: '2026-06-01', skippedPeriods: ['2026-07'] }, '2026-09-15');
    expect(due.map((d) => d.period)).toEqual(['2026-06', '2026-08', '2026-09']);
  });

  it('stops at the end date', () => {
    const due = duePeriods({ ...base, nextDraftDate: '2026-06-01', endDate: '2026-07-31' }, '2026-12-01');
    expect(due.map((d) => d.period)).toEqual(['2026-06', '2026-07']);
  });

  it('bounds catch-up so a very old schedule cannot flood the queue', () => {
    const due = duePeriods({ ...base, nextDraftDate: '2015-01-01' }, '2026-09-25');
    expect(due.length).toBeLessThanOrEqual(12);
  });

  it('carries the 31st anchor through catch-up', () => {
    const due = duePeriods({ ...base, anchorDay: 31, nextDraftDate: '2026-01-31' }, '2026-04-30');
    expect(due.map((d) => d.scheduledFor)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
});

describe('resume', () => {
  it('moves forward instead of back-filling the pause', () => {
    const next = nextDateAfterResume({ ...base, nextDraftDate: '2026-06-01' }, '2026-09-15');
    expect(next).toBe('2026-10-01');
  });

  it('leaves a future date alone', () => {
    expect(nextDateAfterResume({ ...base, nextDraftDate: '2026-12-01' }, '2026-09-15')).toBe('2026-12-01');
  });
});

describe('overdue drafts', () => {
  it('flags a draft whose date is well past for review', () => {
    expect(needsDateReview('2026-08-01', '2026-09-25')).toBe(true);
    expect(needsDateReview('2026-09-24', '2026-09-25')).toBe(false);
  });
});
