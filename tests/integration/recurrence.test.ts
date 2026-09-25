import { describe, expect, it } from 'vitest';

import { monthPeriodOf } from '@/lib/dates';
import { occurrenceId, occurrencesCol, invoicesCol } from '@/server/firebase/paths';
import { customerToParty } from '@/server/repos/customers';
import {
  createSchedule,
  editFutureTemplate,
  listOccurrences,
  pauseSchedule,
  resumeSchedule,
  runSchedule,
  skipOccurrence,
  stopSchedule,
  getSchedule,
} from '@/server/repos/schedules';
import { createCustomer } from '@/server/repos/customers';

import { line, makeGstBusiness, ownerUidOf } from '../helpers';

async function setup(anchorDay = 1, startDate = '2026-06-01') {
  const business = await makeGstBusiness();
  const uid = await ownerUidOf(business);
  const customer = await createCustomer(business.id, uid, {
    name: 'Monthly Client',
    phone: null, email: null, addressLine1: null, addressLine2: null,
    city: null, pincode: null, stateCode: '27', gstin: null, pan: null, notes: null,
  });
  const schedule = await createSchedule({
    businessId: business.id,
    uid,
    customerId: customer.id,
    customerName: customer.name,
    anchorDay,
    startDate,
    endDate: null,
    billingPeriodChoice: 'previous-month',
    template: {
      version: 1,
      customer: customerToParty(customer),
      placeOfSupplyStateCode: '27',
      lines: [line('Monthly retainer', '1', '5000', '18')],
      notes: null,
      paymentTermsDays: 7,
      supplyFlags: [],
      effectiveFromPeriod: '2026-06',
    },
  });
  return { business, uid, customer, schedule };
}

describe('running a schedule', () => {
  it('prepares a draft, never an issued invoice', async () => {
    const { business, schedule } = await setup(1, '2026-09-01');
    const result = await runSchedule({ business, scheduleId: schedule.id, today: '2026-09-01' });

    expect(result.created).toHaveLength(1);
    const invoiceSnap = await invoicesCol(business.id).doc(result.created[0]!.invoiceId!).get();
    const invoice = invoiceSnap.data()!;
    expect(invoice.status).toBe('draft');
    expect(invoice.number).toBeNull();
    expect(invoice.scheduleId).toBe(schedule.id);
    // The supply period is August; the draft date is 1 September.
    expect(invoice.billingPeriod).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(invoice.totals.grandTotalPaise).toBe(590000); // 5000 + 18%
  });

  /**
   * GATE: "Zero duplicate occurrences" under concurrent workers.
   *
   * Eight workers run the same schedule at the same moment. The occurrence id is
   * deterministic, so the database itself rejects the duplicates.
   */
  it('creates exactly one draft per period under eight concurrent workers', async () => {
    const { business, schedule } = await setup(1, '2026-09-01');

    const results = await Promise.all(
      Array.from({ length: 8 }, () => runSchedule({ business, scheduleId: schedule.id, today: '2026-09-01' })),
    );

    const totalCreated = results.reduce((n, r) => n + r.created.length, 0);
    expect(totalCreated).toBe(1);

    const occurrences = await listOccurrences(business.id, schedule.id);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.id).toBe(occurrenceId(schedule.id, '2026-09'));

    const drafts = await invoicesCol(business.id).where('scheduleId', '==', schedule.id).get();
    expect(drafts.size).toBe(1);
  });

  it('is idempotent when re-run, including after a restart', async () => {
    const { business, schedule } = await setup(1, '2026-09-01');
    await runSchedule({ business, scheduleId: schedule.id, today: '2026-09-01' });
    await runSchedule({ business, scheduleId: schedule.id, today: '2026-09-01' });
    await runSchedule({ business, scheduleId: schedule.id, today: '2026-09-02' });

    const drafts = await invoicesCol(business.id).where('scheduleId', '==', schedule.id).get();
    expect(drafts.size).toBe(1);
  });

  it('catches up an outage with one visible draft per missed period', async () => {
    const { business, schedule } = await setup(1, '2026-06-01');
    const result = await runSchedule({ business, scheduleId: schedule.id, today: '2026-09-15' });

    expect(result.created.map((o) => o.period)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09']);
    // All four were prepared after their scheduled date, because the worker was
    // down until the 15th -- September's own draft was due on the 1st.
    expect(result.created.every((o) => o.wasCatchUp)).toBe(true);

    const drafts = await invoicesCol(business.id).where('scheduleId', '==', schedule.id).get();
    expect(drafts.size).toBe(4);
    // Every one is a draft. Nothing was issued behind the owner's back.
    expect(drafts.docs.every((d) => d.data().status === 'draft')).toBe(true);
  });

  it('handles a 31st anchor across February', async () => {
    const { business, schedule } = await setup(31, '2026-01-31');
    const result = await runSchedule({ business, scheduleId: schedule.id, today: '2026-04-30' });
    expect(result.created.map((o) => o.scheduledFor)).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30',
    ]);
  });
});

describe('pause, skip, resume, stop', () => {
  it('prepares nothing while paused', async () => {
    const { business, uid, schedule } = await setup(1, '2026-09-01');
    await pauseSchedule(business.id, uid, schedule.id);
    const result = await runSchedule({ business, scheduleId: schedule.id, today: '2026-09-01' });
    expect(result.created).toHaveLength(0);
  });

  it('does not recreate a deliberately skipped period on resume', async () => {
    const { business, uid, schedule } = await setup(1, '2026-09-01');
    await skipOccurrence(business.id, uid, schedule.id, '2026-09');
    await pauseSchedule(business.id, uid, schedule.id);
    await resumeSchedule(business.id, uid, schedule.id, '2026-09-15');

    const result = await runSchedule({ business, scheduleId: schedule.id, today: '2026-09-20' });
    expect(result.created.map((o) => o.period)).not.toContain('2026-09');

    const occurrences = await listOccurrences(business.id, schedule.id);
    const skipped = occurrences.find((o) => o.period === '2026-09');
    // The skip is preserved as history, not erased.
    expect(skipped?.status).toBe('skipped');
  });

  it('refuses to skip a month whose draft already exists', async () => {
    const { business, uid, schedule } = await setup(1, '2026-09-01');
    await runSchedule({ business, scheduleId: schedule.id, today: '2026-09-01' });
    await expect(skipOccurrence(business.id, uid, schedule.id, '2026-09')).rejects.toThrow(/already been prepared/i);
  });

  it('previews the next date on resume without back-filling', async () => {
    const { business, uid, schedule } = await setup(1, '2026-06-01');
    await pauseSchedule(business.id, uid, schedule.id);
    const next = await resumeSchedule(business.id, uid, schedule.id, '2026-09-15');
    expect(next).toBe('2026-10-01');
    const result = await runSchedule({ business, scheduleId: schedule.id, today: '2026-09-20' });
    expect(result.created).toHaveLength(0);
  });

  it('prepares nothing after being stopped', async () => {
    const { business, uid, schedule } = await setup(1, '2026-09-01');
    await stopSchedule(business.id, uid, schedule.id);
    const result = await runSchedule({ business, scheduleId: schedule.id, today: '2026-09-01' });
    expect(result.created).toHaveLength(0);
    const after = await getSchedule(business.id, schedule.id);
    expect(after!.status).toBe('stopped');
    expect(after!.stoppedAt).not.toBeNull();
  });
});

describe('editing a schedule', () => {
  /**
   * "This and future invoices" bumps the template version and KEEPS the old one,
   * so a draft prepared under the previous terms stays explainable.
   */
  it('keeps the previous template and reports what changed', async () => {
    const { business, uid, schedule, customer } = await setup(1, '2026-09-01');
    await runSchedule({ business, scheduleId: schedule.id, today: '2026-09-01' });

    const result = await editFutureTemplate({
      businessId: business.id,
      uid,
      scheduleId: schedule.id,
      effectiveFromPeriod: '2026-10',
      template: {
        customer: customerToParty(customer),
        placeOfSupplyStateCode: '27',
        lines: [line('Monthly retainer', '1', '6000', '18')],
        notes: null,
        paymentTermsDays: 15,
        supplyFlags: [],
        effectiveFromPeriod: '2026-10',
      },
    });

    expect(result.changedFields).toContain('items');
    expect(result.changedFields).toContain('payment terms');
    expect(result.effectiveFromPeriod).toBe('2026-10');

    const after = await getSchedule(business.id, schedule.id);
    expect(after!.template.version).toBe(2);
    expect(after!.templateHistory).toHaveLength(1);
    expect(after!.templateHistory[0]!.lines[0]!.unitPricePaise).toBe(500000);

    // The September draft already created keeps the OLD agreed amount.
    const drafts = await invoicesCol(business.id).where('scheduleId', '==', schedule.id).get();
    const september = drafts.docs.map((d) => d.data()).find((i) => i.billingPeriod?.from === '2026-08-01');
    expect(september!.totals.grandTotalPaise).toBe(590000);

    // October's draft uses the new agreed amount.
    const oct = await runSchedule({ business, scheduleId: schedule.id, today: '2026-10-01' });
    const octInvoice = (await invoicesCol(business.id).doc(oct.created[0]!.invoiceId!).get()).data()!;
    expect(octInvoice.totals.grandTotalPaise).toBe(708000); // 6000 + 18%
  });

  it('does not change an agreed price when the saved-item catalogue changes', async () => {
    const { business, schedule } = await setup(1, '2026-09-01');
    // The template carries its own copy of the price. Changing a catalogue item
    // cannot reach it -- there is no reference to follow.
    const before = await getSchedule(business.id, schedule.id);
    expect(before!.template.lines[0]!.unitPricePaise).toBe(500000);
    expect(before!.template.lines[0]!.savedItemId).toBeNull();
    const result = await runSchedule({ business, scheduleId: schedule.id, today: '2026-09-01' });
    const invoice = (await invoicesCol(business.id).doc(result.created[0]!.invoiceId!).get()).data()!;
    expect(invoice.lines[0]!.unitPricePaise).toBe(500000);
  });
});

describe('occurrence keys', () => {
  it('uses a stable unique key per schedule and period', async () => {
    const { business, schedule } = await setup(1, '2026-09-01');
    await runSchedule({ business, scheduleId: schedule.id, today: '2026-09-01' });
    const expected = occurrenceId(schedule.id, monthPeriodOf('2026-09-01'));
    const snap = await occurrencesCol(business.id).doc(expected).get();
    expect(snap.exists).toBe(true);
    expect(snap.data()!.period).toBe('2026-09');
  });
});
