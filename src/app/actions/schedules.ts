'use server';

import { revalidatePath } from 'next/cache';

import { addMonths, monthPeriodOf, partsOf, todayIst, type CivilDate, type MonthPeriod } from '@/lib/dates';
import type { BillingPeriodChoice, RecurringScheduleRecord } from '@/lib/domain/types';
import { requireBusiness } from '@/server/auth/guard';
import { getInvoice } from '@/server/repos/invoices';
import {
  createSchedule,
  editFutureTemplate,
  getSchedule,
  listOccurrences,
  listSchedules,
  pauseSchedule,
  resumeSchedule,
  skipOccurrence,
  stopSchedule,
} from '@/server/repos/schedules';
import { billingPeriodExample } from '@/server/services/recurrence';

import { ok, toActionError, type ActionResult } from './common';

/**
 * Turn an existing bill into a monthly schedule.
 *
 * The bill's items, prices and terms become the AGREED TEMPLATE, copied by
 * value. A later change to a saved item cannot move an agreed monthly fee,
 * because the template holds its own copy of the figure.
 *
 * Creating a schedule issues nothing and sends nothing. It only means a draft
 * will be prepared for review each month.
 */
export async function startMonthlyScheduleAction(
  businessId: string,
  input: {
    sourceInvoiceId: string;
    anchorDay: number;
    startDate: CivilDate;
    endDate: CivilDate | null;
    billingPeriodChoice: BillingPeriodChoice;
  },
): Promise<ActionResult<{ scheduleId: string; nextDraftDate: CivilDate }>> {
  try {
    const { business, user } = await requireBusiness(businessId);

    const invoice = await getInvoice(businessId, input.sourceInvoiceId);
    if (!invoice) return { ok: false, error: 'That bill no longer exists.' };
    if (!invoice.customer.customerId) {
      return {
        ok: false,
        error: 'A monthly bill needs a saved customer, so we know who to prepare it for. Add the customer first.',
      };
    }
    if (input.anchorDay < 1 || input.anchorDay > 31) {
      return { ok: false, error: 'Choose a day between 1 and 31.' };
    }
    if (input.endDate && input.endDate <= input.startDate) {
      return { ok: false, error: 'The end date must be after the first draft date.' };
    }

    const schedule = await createSchedule({
      businessId,
      uid: user.uid,
      customerId: invoice.customer.customerId,
      customerName: invoice.customer.name,
      anchorDay: input.anchorDay,
      startDate: input.startDate,
      endDate: input.endDate,
      billingPeriodChoice: input.billingPeriodChoice,
      template: {
        version: 1,
        customer: invoice.customer,
        placeOfSupplyStateCode: invoice.placeOfSupplyStateCode,
        // Copied by value: the agreed price travels with the schedule.
        lines: invoice.lines.map((l) => ({ ...l, savedItemId: null })),
        notes: invoice.notes,
        paymentTermsDays: invoice.paymentTermsDays ?? business.defaultPaymentTermsDays,
        supplyFlags: invoice.supplyFlags,
        effectiveFromPeriod: monthPeriodOf(input.startDate),
      },
    });

    revalidatePath('/home');
    revalidatePath(`/bills/${input.sourceInvoiceId}`);
    return ok({ scheduleId: schedule.id, nextDraftDate: schedule.nextDraftDate! });
  } catch (error) {
    return toActionError(error);
  }
}

export async function pauseScheduleAction(businessId: string, scheduleId: string): Promise<ActionResult<null>> {
  try {
    const { user } = await requireBusiness(businessId);
    await pauseSchedule(businessId, user.uid, scheduleId);
    revalidatePath('/home');
    return ok(null);
  } catch (error) {
    return toActionError(error);
  }
}

export async function resumeScheduleAction(
  businessId: string,
  scheduleId: string,
): Promise<ActionResult<{ nextDraftDate: CivilDate }>> {
  try {
    const { user } = await requireBusiness(businessId);
    const next = await resumeSchedule(businessId, user.uid, scheduleId);
    revalidatePath('/home');
    return ok({ nextDraftDate: next });
  } catch (error) {
    return toActionError(error);
  }
}

export async function skipNextOccurrenceAction(
  businessId: string,
  scheduleId: string,
  period: MonthPeriod,
): Promise<ActionResult<null>> {
  try {
    const { user } = await requireBusiness(businessId);
    await skipOccurrence(businessId, user.uid, scheduleId, period);
    revalidatePath('/home');
    return ok(null);
  } catch (error) {
    return toActionError(error);
  }
}

export async function stopScheduleAction(businessId: string, scheduleId: string): Promise<ActionResult<null>> {
  try {
    const { user } = await requireBusiness(businessId);
    await stopSchedule(businessId, user.uid, scheduleId);
    revalidatePath('/home');
    return ok(null);
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Apply a draft's current items to this and every future month.
 *
 * The caller has already seen the preview of what changes and from when. The
 * previous template is kept in history, so a draft prepared under the old terms
 * remains explainable.
 */
export async function applyToFutureInvoicesAction(
  businessId: string,
  input: { scheduleId: string; fromInvoiceId: string },
): Promise<ActionResult<{ changedFields: string[]; effectiveFromPeriod: MonthPeriod }>> {
  try {
    const { business, user } = await requireBusiness(businessId);
    const invoice = await getInvoice(businessId, input.fromInvoiceId);
    if (!invoice) return { ok: false, error: 'That bill no longer exists.' };

    const schedule = await getSchedule(businessId, input.scheduleId);
    if (!schedule) return { ok: false, error: 'That monthly bill no longer exists.' };

    const result = await editFutureTemplate({
      businessId,
      uid: user.uid,
      scheduleId: input.scheduleId,
      effectiveFromPeriod: monthPeriodOf(invoice.issueDate),
      template: {
        customer: invoice.customer,
        placeOfSupplyStateCode: invoice.placeOfSupplyStateCode,
        lines: invoice.lines.map((l) => ({ ...l, savedItemId: null })),
        notes: invoice.notes,
        paymentTermsDays: invoice.paymentTermsDays ?? business.defaultPaymentTermsDays,
        supplyFlags: invoice.supplyFlags,
        effectiveFromPeriod: monthPeriodOf(invoice.issueDate),
      },
    });

    revalidatePath('/home');
    revalidatePath(`/bills/${input.fromInvoiceId}`);
    return ok(result);
  } catch (error) {
    return toActionError(error);
  }
}

export interface ScheduleSummary {
  schedule: RecurringScheduleRecord;
  occurrenceCount: number;
  skippedCount: number;
  /** The worked example shown next to the billing-period choice. */
  example: string;
}

export async function loadSchedulesAction(businessId: string): Promise<ActionResult<ScheduleSummary[]>> {
  try {
    await requireBusiness(businessId);
    const schedules = await listSchedules(businessId);
    const summaries = await Promise.all(
      schedules.map(async (schedule) => ({
        schedule,
        occurrenceCount: (await listOccurrences(businessId, schedule.id)).length,
        skippedCount: schedule.skippedPeriods.length,
        example: billingPeriodExample(schedule.nextDraftDate ?? todayIst(), schedule.billingPeriodChoice),
      })),
    );
    return ok(summaries);
  } catch (error) {
    return toActionError(error);
  }
}

/** The default first draft date: the same day next month, clamped. */
export async function suggestFirstDraftDateAction(from: CivilDate): Promise<ActionResult<{ date: CivilDate; anchorDay: number }>> {
  const anchorDay = partsOf(from).day;
  return ok({ date: addMonths(from, 1, anchorDay), anchorDay });
}
