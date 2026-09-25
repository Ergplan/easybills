/**
 * Two things happening at once, to the same bill.
 *
 * A small business owner has one phone and a habit of tapping twice when a
 * screen is slow. They also leave a bill open on a laptop while their brother
 * settles the same bill on his. Every write below is therefore attempted
 * concurrently against real transactions, and the question asked of each is
 * not "does it error nicely" but "what does the ledger say afterwards".
 */
import { describe, expect, it } from 'vitest';

import { todayIst } from '@/lib/dates';
import {
  AdjustmentError,
  createAdjustment,
  listAdjustmentsForInvoice,
} from '@/server/repos/adjustments';
import {
  PaymentError,
  listPaymentsForInvoice,
  recordPayment,
  recordSettlementDeduction,
  reversePayment,
} from '@/server/repos/payments';
import {
  DraftConflictError,
  InvoiceStateError,
  cancelDraft,
  duplicateInvoice,
  emptyParty,
  getInvoice,
  issueInvoice,
  newInvoiceId,
  saveDraft,
} from '@/server/repos/invoices';
import { countersCol } from '@/server/firebase/paths';

import { line, makeGstBusiness, ownerUidOf } from '../helpers';

async function draft(amount = '2050') {
  const business = await makeGstBusiness();
  const uid = await ownerUidOf(business);
  const d = await saveDraft({
    business,
    uid,
    invoiceId: newInvoiceId(),
    kind: 'customer-invoice',
    issueDate: todayIst(),
    customer: { ...emptyParty('Sharma Electricals'), stateCode: '27' },
    placeOfSupplyStateCode: '27',
    supplyFlags: [],
    lines: [line('Consulting', '1', amount, '0')],
    notes: null,
    baseRevision: 0,
  });
  return { business, uid, draft: d };
}

async function issued(amount = '2050') {
  const { business, uid, draft: d } = await draft(amount);
  const { invoice } = await issueInvoice({ business, uid, invoiceId: d.id });
  return { business, uid, invoice };
}

/** Run everything at once and report which settled how, without throwing. */
async function race<T>(tasks: Array<() => Promise<T>>) {
  const settled = await Promise.allSettled(tasks.map((t) => t()));
  return {
    settled,
    ok: settled.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<T>).value),
    failed: settled.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason as Error),
  };
}

// ---------------------------------------------------------------------------

describe('two tabs on the same draft', () => {
  it('lets the second save through only when it saw the first', async () => {
    const { business, uid, draft: d } = await draft();

    // Both tabs loaded at revision N. The first save wins; the second is
    // working from a page that no longer describes the bill.
    const attempt = (desc: string) =>
      saveDraft({
        business,
        uid,
        invoiceId: d.id,
        kind: 'customer-invoice',
        issueDate: d.issueDate,
        customer: d.customer,
        placeOfSupplyStateCode: '27',
        supplyFlags: [],
        lines: [line(desc, '1', '2050', '0')],
        notes: null,
        baseRevision: d.revision,
      });

    const { ok, failed } = await race([() => attempt('From the laptop'), () => attempt('From the phone')]);

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toBeInstanceOf(DraftConflictError);

    // The surviving edit is one of the two, whole. Neither is half-applied.
    const after = await getInvoice(business.id, d.id);
    expect(after!.lines).toHaveLength(1);
    expect(['From the laptop', 'From the phone']).toContain(after!.lines[0]!.description);
    expect(after!.revision).toBe(d.revision + 1);
  });

  it('refuses a save from a tab that has not seen the bill being issued', async () => {
    const { business, uid, draft: d } = await draft();
    await issueInvoice({ business, uid, invoiceId: d.id });

    await expect(
      saveDraft({
        business,
        uid,
        invoiceId: d.id,
        kind: 'customer-invoice',
        issueDate: d.issueDate,
        customer: d.customer,
        placeOfSupplyStateCode: '27',
        supplyFlags: [],
        lines: [line('Edited after issue', '1', '9999', '0')],
        notes: null,
        baseRevision: d.revision,
      }),
    ).rejects.toBeInstanceOf(InvoiceStateError);

    // The issued document is exactly what was issued.
    const after = await getInvoice(business.id, d.id);
    expect(after!.status).toBe('issued');
    expect(after!.lines[0]!.description).toBe('Consulting');
  });

  it('refuses to delete a draft that has just been issued elsewhere', async () => {
    const { business, uid, draft: d } = await draft();
    await issueInvoice({ business, uid, invoiceId: d.id });
    await expect(cancelDraft(business.id, d.id)).rejects.toBeInstanceOf(InvoiceStateError);
    expect((await getInvoice(business.id, d.id))!.status).toBe('issued');
  });

  it('issues once and allocates one number when both tabs tap Issue', async () => {
    const { business, uid, draft: d } = await draft();
    const { ok, failed } = await race(
      Array.from({ length: 5 }, () => () => issueInvoice({ business, uid, invoiceId: d.id })),
    );

    expect(failed).toHaveLength(0);
    const numbers = new Set(ok.map((r) => r.invoice.number));
    expect(numbers.size).toBe(1);
    expect(ok.filter((r) => !r.alreadyIssued)).toHaveLength(1);

    // The counter moved exactly once, so the next bill is not given a gap.
    const counters = await countersCol(business.id).get();
    const series = counters.docs.find((c) => c.id.includes('default'));
    expect(series!.data().nextNumber).toBe(2);
  });

  it('gives two duplicates of one bill their own separate drafts', async () => {
    const { business, uid, invoice } = await issued();
    const { ok, failed } = await race([
      () => duplicateInvoice({ business, uid, sourceInvoiceId: invoice.id }),
      () => duplicateInvoice({ business, uid, sourceInvoiceId: invoice.id }),
    ]);
    expect(failed).toHaveLength(0);
    expect(new Set(ok.map((c) => c.id)).size).toBe(2);
    for (const copy of ok) {
      expect(copy.status).toBe('draft');
      expect(copy.number).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------

describe('a payment recorded twice', () => {
  it('refuses the second of two full settlements of the same bill', async () => {
    const { business, uid, invoice } = await issued('2050');
    const pay = () =>
      recordPayment({
        businessId: business.id,
        uid,
        customerId: null,
        receivedOn: todayIst(),
        amountPaise: 205000,
        method: 'cash',
        reference: null,
        note: null,
        allocations: [{ invoiceId: invoice.id, amountPaise: 205000 }],
      });

    const { ok, failed } = await race([pay, pay]);

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toBeInstanceOf(PaymentError);

    const after = await getInvoice(business.id, invoice.id);
    expect(after!.amountPaidPaise).toBe(205000);
    expect(after!.balancePaise).toBe(0);
    expect(await listPaymentsForInvoice(business.id, invoice.id)).toHaveLength(1);
  });

  // The dangerous case: a part payment is small enough that a second copy of it
  // still fits inside the balance, so nothing in the amounts says "wrong".
  it('does not take the same part payment twice', async () => {
    const { business, uid, invoice } = await issued('2050');
    const pay = () =>
      recordPayment({
        businessId: business.id,
        uid,
        customerId: null,
        receivedOn: todayIst(),
        amountPaise: 100000,
        method: 'cash',
        reference: null,
        note: null,
        allocations: [{ invoiceId: invoice.id, amountPaise: 100000 }],
        idempotencyKey: 'one-tap',
      });

    const { ok, failed } = await race([pay, pay]);

    expect(failed).toHaveLength(0);
    expect(new Set(ok.map((p) => p.id)).size).toBe(1);

    const after = await getInvoice(business.id, invoice.id);
    expect(after!.amountPaidPaise).toBe(100000);
    expect(after!.balancePaise).toBe(105000);
    expect(await listPaymentsForInvoice(business.id, invoice.id)).toHaveLength(1);
  });

  it('still takes two genuinely separate part payments of the same amount', async () => {
    const { business, uid, invoice } = await issued('2050');
    const pay = (key: string) =>
      recordPayment({
        businessId: business.id,
        uid,
        customerId: null,
        receivedOn: todayIst(),
        amountPaise: 100000,
        method: 'cash',
        reference: null,
        note: null,
        allocations: [{ invoiceId: invoice.id, amountPaise: 100000 }],
        idempotencyKey: key,
      });

    await pay('monday');
    await pay('tuesday');

    const after = await getInvoice(business.id, invoice.id);
    expect(after!.amountPaidPaise).toBe(200000);
    expect(await listPaymentsForInvoice(business.id, invoice.id)).toHaveLength(2);
  });

  it('reverses a payment once however many times the button is tapped', async () => {
    const { business, uid, invoice } = await issued('2050');
    const payment = await recordPayment({
      businessId: business.id,
      uid,
      customerId: null,
      receivedOn: todayIst(),
      amountPaise: 100000,
      method: 'cash',
      reference: null,
      note: null,
      allocations: [{ invoiceId: invoice.id, amountPaise: 100000 }],
    });

    const undo = () => reversePayment({ businessId: business.id, uid, paymentId: payment.id, reason: 'Cheque bounced', reversedOn: todayIst() });
    const { ok, failed } = await race([undo, undo, undo]);

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(2);
    for (const e of failed) expect(e).toBeInstanceOf(PaymentError);

    const after = await getInvoice(business.id, invoice.id);
    expect(after!.amountPaidPaise).toBe(0);
    expect(after!.balancePaise).toBe(205000);
  });

  it('does not deduct the same settlement twice', async () => {
    const { business, uid, invoice } = await issued('2050');
    const deduct = () =>
      recordSettlementDeduction({
        businessId: business.id,
        uid,
        invoiceId: invoice.id,
        amountPaise: 20500,
        reason: 'TDS',
        onDate: todayIst(),
        idempotencyKey: 'one-tap',
      });

    const { ok, failed } = await race([deduct, deduct]);
    expect(failed).toHaveLength(0);
    expect(new Set(ok.map((d) => d.id)).size).toBe(1);

    const after = await getInvoice(business.id, invoice.id);
    expect(after!.settlementDeductionPaise).toBe(20500);
    expect(after!.balancePaise).toBe(184500);
  });
});

// ---------------------------------------------------------------------------

describe('a credit note raised twice', () => {
  it('raises one note per tap-through, each with its own number', async () => {
    const { business, uid, invoice } = await issued('2050');
    const raise = (key: string) =>
      createAdjustment({
        business,
        uid,
        invoiceId: invoice.id,
        kind: 'credit-note',
        amountPaise: 5000,
        reason: 'One item was billed twice',
        affectsTaxLiability: false,
        idempotencyKey: key,
      });

    const { ok, failed } = await race([() => raise('tap-a'), () => raise('tap-b')]);
    expect(failed).toHaveLength(0);

    // Two deliberate notes are two notes -- but they must not share a number.
    expect(new Set(ok.map((a) => a.number)).size).toBe(2);
    const after = await getInvoice(business.id, invoice.id);
    expect(after!.creditAppliedPaise).toBe(10000);
    expect(after!.balancePaise).toBe(195000);
  });

  it('does not raise the same note twice from one double tap', async () => {
    const { business, uid, invoice } = await issued('2050');
    const raise = () =>
      createAdjustment({
        business,
        uid,
        invoiceId: invoice.id,
        kind: 'credit-note',
        amountPaise: 5000,
        reason: 'One item was billed twice',
        affectsTaxLiability: false,
        idempotencyKey: 'one-tap',
      });

    const { ok, failed } = await race([raise, raise]);
    expect(failed).toHaveLength(0);
    expect(new Set(ok.map((a) => a.id)).size).toBe(1);

    expect(await listAdjustmentsForInvoice(business.id, invoice.id)).toHaveLength(1);
    const after = await getInvoice(business.id, invoice.id);
    expect(after!.creditAppliedPaise).toBe(5000);
  });

  it('refuses a credit note that would take the bill below zero, however it races', async () => {
    const { business, uid, invoice } = await issued('2050');
    const raise = (key: string) =>
      createAdjustment({
        business,
        uid,
        invoiceId: invoice.id,
        kind: 'credit-note',
        amountPaise: 150000,
        reason: 'Cancelled most of the work',
        affectsTaxLiability: false,
        idempotencyKey: key,
      });

    const { ok, failed } = await race([() => raise('a'), () => raise('b')]);
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toBeInstanceOf(AdjustmentError);

    const after = await getInvoice(business.id, invoice.id);
    expect(after!.creditAppliedPaise).toBe(150000);
    expect(after!.balancePaise).toBe(55000);
  });
});
