import 'server-only';

import { randomUUID } from 'node:crypto';

import { addDays, monthPeriodOf, todayIst, type CivilDate, type MonthPeriod } from '@/lib/dates';
import type {
  BillingPeriodChoice,
  BusinessRecord,
  RecurringOccurrenceRecord,
  RecurringScheduleRecord,
  RecurringTemplate,
} from '@/lib/domain/types';
import { db } from '@/server/firebase/admin';
import { invoicesCol, occurrenceId, occurrencesCol, schedulesCol } from '@/server/firebase/paths';
import { recordAudit, recordAuditInTransaction } from '@/server/services/audit';
import { computeDueDate, priceInvoice } from '@/server/services/invoice-calc';
import { advance, duePeriods, nextDateAfterResume } from '@/server/services/recurrence';

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleError';
  }
}

export async function createSchedule(args: {
  businessId: string;
  uid: string;
  customerId: string | null;
  customerName: string;
  anchorDay: number;
  startDate: CivilDate;
  endDate: CivilDate | null;
  billingPeriodChoice: BillingPeriodChoice;
  template: RecurringTemplate;
}): Promise<RecurringScheduleRecord> {
  if (args.anchorDay < 1 || args.anchorDay > 31) throw new ScheduleError('Choose a day between 1 and 31.');
  const now = new Date().toISOString();
  const record: RecurringScheduleRecord = {
    id: randomUUID(),
    status: 'active',
    customerId: args.customerId,
    customerName: args.customerName,
    anchorDay: args.anchorDay,
    nextDraftDate: args.startDate,
    endDate: args.endDate,
    billingPeriodChoice: args.billingPeriodChoice,
    template: args.template,
    templateHistory: [],
    skippedPeriods: [],
    pausedAt: null,
    stoppedAt: null,
    lastRunAt: null,
    createdAt: now,
    updatedAt: now,
    createdByUid: args.uid,
  };
  await schedulesCol(args.businessId).doc(record.id).set(record);
  await recordAudit(args.businessId, {
    actorUid: args.uid,
    actorKind: 'user',
    action: 'schedule.created',
    subjectType: 'schedule',
    subjectId: record.id,
    detail: { anchorDay: args.anchorDay, billingPeriodChoice: args.billingPeriodChoice },
  });
  return record;
}

export async function getSchedule(businessId: string, scheduleId: string): Promise<RecurringScheduleRecord | null> {
  const snap = await schedulesCol(businessId).doc(scheduleId).get();
  return snap.exists ? (snap.data() as RecurringScheduleRecord) : null;
}

export async function listSchedules(businessId: string): Promise<RecurringScheduleRecord[]> {
  const snap = await schedulesCol(businessId).limit(200).get();
  return snap.docs.map((d) => d.data() as RecurringScheduleRecord);
}

/**
 * Run one schedule, creating at most one draft per due period.
 *
 * THE UNIQUENESS GUARANTEE
 * ------------------------
 * Each occurrence has a deterministic document id: `${scheduleId}__${period}`.
 * The draft is created with `tx.create()` on that id, which FAILS if the
 * document already exists. So two workers racing, a retry after a timeout, a
 * restart mid-run and a catch-up sweep all converge on exactly one draft per
 * period -- not because the code checks first, but because the database refuses
 * the second write.
 *
 * Nothing here issues, sends or collects anything. Drafts only.
 */
export async function runSchedule(args: {
  business: BusinessRecord;
  scheduleId: string;
  today?: CivilDate;
}): Promise<{ created: RecurringOccurrenceRecord[]; skipped: MonthPeriod[] }> {
  const today = args.today ?? todayIst();
  const businessId = args.business.id;
  const schedule = await getSchedule(businessId, args.scheduleId);
  if (!schedule) throw new ScheduleError('That schedule no longer exists.');
  if (schedule.status !== 'active') return { created: [], skipped: [] };

  const due = duePeriods(
    {
      anchorDay: schedule.anchorDay,
      nextDraftDate: schedule.nextDraftDate ?? today,
      endDate: schedule.endDate,
      billingPeriodChoice: schedule.billingPeriodChoice,
      skippedPeriods: schedule.skippedPeriods,
    },
    today,
  );

  const created: RecurringOccurrenceRecord[] = [];
  const alreadyThere: MonthPeriod[] = [];

  for (const period of due) {
    const occId = occurrenceId(schedule.id, period.period);
    const occRef = occurrencesCol(businessId).doc(occId);
    const invoiceRef = invoicesCol(businessId).doc(randomUUID());

    try {
      const occurrence = await db().runTransaction(async (tx) => {
        // `create` throws if this period already produced an occurrence. That is
        // the whole concurrency defence, and it is enforced by the database.
        const existing = await tx.get(occRef);
        if (existing.exists) throw new AlreadyRunError();

        const now = new Date().toISOString();
        const termsDays = schedule.template.paymentTermsDays;

        // Prices come from the AGREED TEMPLATE, never from the current catalogue.
        // A saved-item price change must not silently alter an agreed monthly fee.
        const { totals } = priceInvoice({
          business: args.business,
          lines: schedule.template.lines,
          placeOfSupplyStateCode: schedule.template.placeOfSupplyStateCode,
          supplyFlags: schedule.template.supplyFlags,
          issueDate: period.scheduledFor,
        });

        tx.set(invoiceRef, {
          id: invoiceRef.id,
          kind: 'customer-invoice',
          status: 'draft',
          number: null,
          numberSequence: null,
          financialYear: null,
          issueDate: period.scheduledFor,
          dueDate: computeDueDate(period.scheduledFor, termsDays),
          paymentTermsDays: termsDays,
          billingPeriod: period.billingPeriod,
          customer: schedule.template.customer,
          placeOfSupplyStateCode: schedule.template.placeOfSupplyStateCode,
          supplyFlags: schedule.template.supplyFlags,
          lines: schedule.template.lines.map((l) => ({ ...l, id: randomUUID() })),
          notes: schedule.template.notes,
          totals,
          paymentStatus: 'unpaid',
          amountPaidPaise: 0,
          creditAppliedPaise: 0,
          debitAppliedPaise: 0,
          settlementDeductionPaise: 0,
          balancePaise: totals.grandTotalPaise,
          issued: null,
          cancelledAt: null,
          cancelledReason: null,
          scheduleId: schedule.id,
          occurrenceKey: occId,
          duplicatedFromInvoiceId: null,
          revision: 1,
          createdAt: now,
          updatedAt: now,
          createdByUid: 'system',
        });

        const occurrence: RecurringOccurrenceRecord = {
          id: occId,
          scheduleId: schedule.id,
          period: period.period,
          status: 'draft-created',
          invoiceId: invoiceRef.id,
          templateVersion: schedule.template.version,
          scheduledFor: period.scheduledFor,
          createdAt: now,
          wasCatchUp: period.isCatchUp,
          failureReason: null,
        };
        tx.create(occRef, occurrence);

        recordAuditInTransaction(tx, businessId, {
          actorUid: null,
          actorKind: 'system',
          action: 'schedule.draft-prepared',
          subjectType: 'schedule',
          subjectId: schedule.id,
          detail: { period: period.period, invoiceId: invoiceRef.id, wasCatchUp: period.isCatchUp },
        });

        return occurrence;
      });
      created.push(occurrence);
    } catch (error) {
      if (error instanceof AlreadyRunError || isAlreadyExists(error)) {
        alreadyThere.push(period.period);
        continue;
      }
      throw error;
    }
  }

  // Move the pointer past everything we considered, so the next run starts fresh.
  if (due.length) {
    const last = due[due.length - 1]!;
    const next = advance(last.scheduledFor, schedule.anchorDay);
    const finished = schedule.endDate && next > schedule.endDate;
    await schedulesCol(businessId).doc(schedule.id).update({
      nextDraftDate: finished ? null : next,
      status: finished ? 'completed' : schedule.status,
      lastRunAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } else {
    await schedulesCol(businessId).doc(schedule.id).update({ lastRunAt: new Date().toISOString() });
  }

  return { created, skipped: alreadyThere };
}

class AlreadyRunError extends Error {}

function isAlreadyExists(error: unknown): boolean {
  const code = (error as { code?: number | string })?.code;
  return code === 6 || code === 'already-exists';
}

// ---------------------------------------------------------------------------
// Owner controls. Each preserves history rather than rewriting it.
// ---------------------------------------------------------------------------

export async function pauseSchedule(businessId: string, uid: string, scheduleId: string): Promise<void> {
  await schedulesCol(businessId).doc(scheduleId).update({
    status: 'paused',
    pausedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await recordAudit(businessId, {
    actorUid: uid, actorKind: 'user', action: 'schedule.paused', subjectType: 'schedule', subjectId: scheduleId, detail: null,
  });
}

export async function resumeSchedule(
  businessId: string,
  uid: string,
  scheduleId: string,
  today: CivilDate = todayIst(),
): Promise<CivilDate> {
  const schedule = await getSchedule(businessId, scheduleId);
  if (!schedule) throw new ScheduleError('That schedule no longer exists.');
  if (schedule.status === 'stopped') throw new ScheduleError('This monthly bill was stopped. Start a new one instead.');

  // Resuming moves forward. Periods deliberately skipped while paused are NOT
  // recreated -- a pause is not a deferral.
  const next = nextDateAfterResume(
    {
      anchorDay: schedule.anchorDay,
      nextDraftDate: schedule.nextDraftDate ?? today,
      endDate: schedule.endDate,
      billingPeriodChoice: schedule.billingPeriodChoice,
      skippedPeriods: schedule.skippedPeriods,
    },
    today,
  );

  await schedulesCol(businessId).doc(scheduleId).update({
    status: 'active',
    pausedAt: null,
    nextDraftDate: next,
    updatedAt: new Date().toISOString(),
  });
  await recordAudit(businessId, {
    actorUid: uid, actorKind: 'user', action: 'schedule.resumed', subjectType: 'schedule', subjectId: scheduleId,
    detail: { nextDraftDate: next },
  });
  return next;
}

/** Skip exactly one occurrence. The period is remembered so resume cannot revive it. */
export async function skipOccurrence(
  businessId: string,
  uid: string,
  scheduleId: string,
  period: MonthPeriod,
): Promise<void> {
  const occRef = occurrencesCol(businessId).doc(occurrenceId(scheduleId, period));
  await db().runTransaction(async (tx) => {
    const schedSnap = await tx.get(schedulesCol(businessId).doc(scheduleId));
    if (!schedSnap.exists) throw new ScheduleError('That schedule no longer exists.');
    const schedule = schedSnap.data() as RecurringScheduleRecord;

    const existing = await tx.get(occRef);
    if (existing.exists && (existing.data() as RecurringOccurrenceRecord).status === 'draft-created') {
      throw new ScheduleError('A draft for that month has already been prepared. Delete the draft instead.');
    }

    tx.set(occRef, {
      id: occRef.id,
      scheduleId,
      period,
      status: 'skipped',
      invoiceId: null,
      templateVersion: schedule.template.version,
      scheduledFor: schedule.nextDraftDate ?? period + '-01',
      createdAt: new Date().toISOString(),
      wasCatchUp: false,
      failureReason: null,
    } satisfies RecurringOccurrenceRecord);

    tx.update(schedulesCol(businessId).doc(scheduleId), {
      skippedPeriods: [...new Set([...schedule.skippedPeriods, period])],
      updatedAt: new Date().toISOString(),
    });

    recordAuditInTransaction(tx, businessId, {
      actorUid: uid, actorKind: 'user', action: 'schedule.skipped', subjectType: 'schedule', subjectId: scheduleId,
      detail: { period },
    });
  });
}

export async function stopSchedule(businessId: string, uid: string, scheduleId: string): Promise<void> {
  await schedulesCol(businessId).doc(scheduleId).update({
    status: 'stopped',
    stoppedAt: new Date().toISOString(),
    nextDraftDate: null,
    updatedAt: new Date().toISOString(),
  });
  await recordAudit(businessId, {
    actorUid: uid, actorKind: 'user', action: 'schedule.stopped', subjectType: 'schedule', subjectId: scheduleId, detail: null,
  });
}

/**
 * Edit the agreed terms from a given period onwards.
 *
 * The previous template is KEPT in `templateHistory`, so a draft created last
 * month can still be explained by the terms that were agreed at the time. Edits
 * that should affect only one bill are made on that bill itself, not here.
 */
export async function editFutureTemplate(args: {
  businessId: string;
  uid: string;
  scheduleId: string;
  template: Omit<RecurringTemplate, 'version'>;
  effectiveFromPeriod: MonthPeriod;
}): Promise<{ changedFields: string[]; effectiveFromPeriod: MonthPeriod }> {
  const ref = schedulesCol(args.businessId).doc(args.scheduleId);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ScheduleError('That schedule no longer exists.');
    const schedule = snap.data() as RecurringScheduleRecord;

    const changedFields: string[] = [];
    if (JSON.stringify(schedule.template.lines) !== JSON.stringify(args.template.lines)) changedFields.push('items');
    if (schedule.template.paymentTermsDays !== args.template.paymentTermsDays) changedFields.push('payment terms');
    if (schedule.template.notes !== args.template.notes) changedFields.push('note');
    if (schedule.template.placeOfSupplyStateCode !== args.template.placeOfSupplyStateCode) {
      changedFields.push('place of supply');
    }

    const nextTemplate: RecurringTemplate = {
      ...args.template,
      version: schedule.template.version + 1,
      effectiveFromPeriod: args.effectiveFromPeriod,
    };

    tx.update(ref, {
      template: nextTemplate,
      templateHistory: [...schedule.templateHistory, schedule.template].slice(-24),
      updatedAt: new Date().toISOString(),
    });

    recordAuditInTransaction(tx, args.businessId, {
      actorUid: args.uid, actorKind: 'user', action: 'schedule.template-updated',
      subjectType: 'schedule', subjectId: args.scheduleId,
      detail: { changedFields, effectiveFromPeriod: args.effectiveFromPeriod, version: nextTemplate.version },
    });

    return { changedFields, effectiveFromPeriod: args.effectiveFromPeriod };
  });
}

export async function listOccurrences(businessId: string, scheduleId: string): Promise<RecurringOccurrenceRecord[]> {
  const snap = await occurrencesCol(businessId).where('scheduleId', '==', scheduleId).limit(100).get();
  return snap.docs.map((d) => d.data() as RecurringOccurrenceRecord).sort((a, b) => a.period.localeCompare(b.period));
}

/** Drafts from a schedule that are now well past their prepared date. */
export async function overdueScheduleDrafts(businessId: string, today: CivilDate = todayIst()) {
  const snap = await invoicesCol(businessId).where('status', '==', 'draft').limit(200).get();
  return snap.docs
    .map((d) => d.data() as { id: string; scheduleId: string | null; issueDate: CivilDate; customer: { name: string } })
    .filter((inv) => inv.scheduleId && inv.issueDate < addDays(today, -7))
    .map((inv) => ({ invoiceId: inv.id, issueDate: inv.issueDate, customerName: inv.customer.name, period: monthPeriodOf(inv.issueDate) }));
}
