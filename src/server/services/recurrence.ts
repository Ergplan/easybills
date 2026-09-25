/**
 * Pure recurrence logic.
 *
 * No database, no clock of its own -- everything is a function of the schedule
 * and a supplied "today". That makes the awkward cases (the 31st, February in a
 * leap year, a financial-year rollover, a worker that was offline for a week)
 * testable exactly, rather than by waiting for a real calendar to produce them.
 */

import {
  addMonths,
  addMonthsToPeriod,
  compareDates,
  daysBetween,
  monthPeriodOf,
  periodBounds,
  type CivilDate,
  type MonthPeriod,
} from '@/lib/dates';
import type { BillingPeriodChoice } from '@/lib/domain/types';

export interface SchedulePlan {
  anchorDay: number;
  nextDraftDate: CivilDate;
  endDate: CivilDate | null;
  billingPeriodChoice: BillingPeriodChoice;
  skippedPeriods: readonly MonthPeriod[];
}

export interface DuePeriod {
  /** The month this occurrence belongs to. Part of its unique key. */
  period: MonthPeriod;
  /** The date the draft was scheduled for. */
  scheduledFor: CivilDate;
  /** The supply period the bill covers, which is NOT the draft date. */
  billingPeriod: { from: CivilDate; to: CivilDate };
  /** True when this period is being produced late, after its scheduled date. */
  isCatchUp: boolean;
}

/**
 * Which periods are due, including any the worker missed.
 *
 * Catch-up is explicit and bounded: each missed period produces its own draft,
 * keyed by its own period, so an outage produces a visible queue of drafts to
 * review rather than one merged bill or a silent gap. Nothing is issued here --
 * these become DRAFTS.
 */
export function duePeriods(plan: SchedulePlan, today: CivilDate, maxCatchUp = 12): DuePeriod[] {
  const due: DuePeriod[] = [];
  let draftDate = plan.nextDraftDate;
  let guard = 0;

  while (compareDates(draftDate, today) <= 0 && guard < maxCatchUp) {
    guard += 1;
    if (plan.endDate && compareDates(draftDate, plan.endDate) > 0) break;

    const period = monthPeriodOf(draftDate);
    if (!plan.skippedPeriods.includes(period)) {
      due.push({
        period,
        scheduledFor: draftDate,
        billingPeriod: billingPeriodFor(draftDate, plan.billingPeriodChoice),
        isCatchUp: compareDates(draftDate, today) < 0,
      });
    }
    draftDate = advance(draftDate, plan.anchorDay);
  }

  return due;
}

/**
 * The next draft date after this one.
 *
 * The ANCHOR DAY is carried separately from the date we landed on, which is what
 * makes a 31st schedule return to the 31st after a short month instead of being
 * permanently dragged back to the 28th.
 */
export function advance(from: CivilDate, anchorDay: number): CivilDate {
  return addMonths(from, 1, anchorDay);
}

/** The supply period a draft covers. */
export function billingPeriodFor(
  draftDate: CivilDate,
  choice: BillingPeriodChoice,
): { from: CivilDate; to: CivilDate } {
  const period = choice === 'previous-month'
    ? addMonthsToPeriod(monthPeriodOf(draftDate), -1)
    : monthPeriodOf(draftDate);
  const { start, end } = periodBounds(period);
  return { from: start, to: end };
}

/** A worked example for the setup screen, so the choice is never abstract. */
export function billingPeriodExample(draftDate: CivilDate, choice: BillingPeriodChoice): string {
  const { from, to } = billingPeriodFor(draftDate, choice);
  return `A draft prepared on ${draftDate} will cover ${from} to ${to}.`;
}

export function nextDateAfterResume(plan: SchedulePlan, today: CivilDate): CivilDate {
  // On resume we move forward to the first date that is not in the past, so a
  // pause does not produce a burst of back-dated drafts the owner never wanted.
  let d = plan.nextDraftDate;
  let guard = 0;
  while (compareDates(d, today) < 0 && guard < 240) {
    d = advance(d, plan.anchorDay);
    guard += 1;
  }
  return d;
}

/**
 * Whether an overdue draft needs its date reviewed before issuing.
 *
 * A draft prepared for August and issued in November is not automatically wrong,
 * but it is never silently back-dated -- the owner is asked.
 */
export function needsDateReview(scheduledFor: CivilDate, today: CivilDate, toleranceDays = 7): boolean {
  return daysBetween(scheduledFor, today) > toleranceDays;
}
