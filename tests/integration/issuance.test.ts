import { describe, expect, it } from 'vitest';

import { todayIst } from '@/lib/dates';
import {
  DraftConflictError,
  IssuanceBlockedError,
  InvoiceStateError,
  duplicateInvoice,
  emptyParty,
  getInvoice,
  issueInvoice,
  newInvoiceId,
  saveDraft,
} from '@/server/repos/invoices';
import { updateBusiness } from '@/server/repos/business';

import { line, makeGstBusiness, makeUnregisteredBusiness, ownerUidOf } from '../helpers';

async function draftFor(business: Awaited<ReturnType<typeof makeGstBusiness>>, uid: string, rate = '18') {
  return saveDraft({
    business,
    uid,
    invoiceId: newInvoiceId(),
    kind: 'customer-invoice',
    issueDate: todayIst(),
    customer: { ...emptyParty('Sharma Electricals'), stateCode: '27' },
    placeOfSupplyStateCode: '27',
    supplyFlags: [],
    lines: [line('Repair visit', '2', '800', rate), line('Spare parts', '1', '450', rate)],
    notes: null,
    baseRevision: 0,
  });
}

describe('draft lifecycle', () => {
  it('creates and recovers a draft end to end', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const draft = await draftFor(business, uid);

    expect(draft.status).toBe('draft');
    expect(draft.number).toBeNull();
    expect(draft.totals.grandTotalPaise).toBe(241900);

    const reloaded = await getInvoice(business.id, draft.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.totals.grandTotalPaise).toBe(241900);
    expect(reloaded!.lines).toHaveLength(2);
  });

  it('recomputes totals server-side and ignores anything the client might claim', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const draft = await draftFor(business, uid);
    // The draft input has no totals field at all -- they are derived here.
    expect(draft.totals.cgstPaise).toBe(18450);
    expect(draft.totals.sgstPaise).toBe(18450);
    expect(draft.totals.taxableValuePaise).toBe(205000);
  });

  /**
   * A draft is allowed to be unfinished. Requiring a line to SAVE meant the
   * autosave of an untouched form failed, and the failure rendered as a red
   * error in the save-status slot before the owner had typed anything.
   */
  it('saves a draft that has no items yet', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const id = newInvoiceId();

    const draft = await saveDraft({
      business,
      uid,
      invoiceId: id,
      kind: 'customer-invoice',
      issueDate: todayIst(),
      customer: emptyParty('Someone I just picked'),
      placeOfSupplyStateCode: '27',
      supplyFlags: [],
      lines: [],
      notes: null,
      baseRevision: 0,
    });

    expect(draft.status).toBe('draft');
    expect(draft.lines).toHaveLength(0);
    expect(draft.totals.grandTotalPaise).toBe(0);
    // The customer they picked is safely stored.
    expect((await getInvoice(business.id, id))!.customer.name).toBe('Someone I just picked');
  });

  it('still refuses to ISSUE a bill with no items', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const id = newInvoiceId();
    await saveDraft({
      business, uid, invoiceId: id, kind: 'customer-invoice', issueDate: todayIst(),
      customer: emptyParty('Someone'), placeOfSupplyStateCode: '27', supplyFlags: [],
      lines: [], notes: null, baseRevision: 0,
    });
    await expect(issueInvoice({ business, uid, invoiceId: id })).rejects.toThrow(/at least one item/i);
  });

  it('refuses a stale overwrite instead of losing the newer edit', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const draft = await draftFor(business, uid);

    // A second device saves first, moving the revision on.
    await saveDraft({
      business,
      uid,
      invoiceId: draft.id,
      kind: 'customer-invoice',
      issueDate: todayIst(),
      customer: emptyParty('Sharma Electricals'),
      placeOfSupplyStateCode: '27',
      supplyFlags: [],
      lines: [line('Repair visit', '3', '800', '18')],
      notes: null,
      baseRevision: draft.revision,
    });

    // The first device now tries to save against the revision it last saw.
    await expect(
      saveDraft({
        business,
        uid,
        invoiceId: draft.id,
        kind: 'customer-invoice',
        issueDate: todayIst(),
        customer: emptyParty('Sharma Electricals'),
        placeOfSupplyStateCode: '27',
        supplyFlags: [],
        lines: [line('Stale edit', '1', '100', '18')],
        notes: null,
        baseRevision: draft.revision,
      }),
    ).rejects.toBeInstanceOf(DraftConflictError);

    const current = await getInvoice(business.id, draft.id);
    expect(current!.lines[0]!.description).toBe('Repair visit');
    expect(current!.lines[0]!.quantityMilli).toBe(3000);
  });
});

describe('issuance', () => {
  it('allocates a number and writes an immutable snapshot', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const draft = await draftFor(business, uid);

    const { invoice, alreadyIssued } = await issueInvoice({ business, uid, invoiceId: draft.id });
    expect(alreadyIssued).toBe(false);
    expect(invoice.status).toBe('issued');
    expect(invoice.number).toBe('INV-001');
    expect(invoice.financialYear).toMatch(/^\d{4}-\d{2}$/);
    expect(invoice.issued).not.toBeNull();
    expect(invoice.issued!.documentTitle).toBe('Tax Invoice');
    expect(invoice.issued!.seller.legalName).toBe('Test Services');
    expect(invoice.issued!.supplyType).toBe('intra-state');
    expect(invoice.balancePaise).toBe(241900);
    expect(invoice.paymentStatus).toBe('unpaid');
  });

  /**
   * GATE: "concurrent issue/retry gives one invoice".
   *
   * Ten simultaneous issue calls on the same draft. Exactly one must perform the
   * allocation; the rest must observe the already-issued invoice and return it
   * unchanged. Firestore retries contended transactions, so this exercises the
   * real contention path, not a mocked one.
   */
  it('issues exactly once under ten concurrent attempts', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const draft = await draftFor(business, uid);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => issueInvoice({ business, uid, invoiceId: draft.id })),
    );

    const freshIssues = results.filter((r) => !r.alreadyIssued);
    expect(freshIssues).toHaveLength(1);

    const numbers = new Set(results.map((r) => r.invoice.number));
    expect(numbers.size).toBe(1);
    expect([...numbers][0]).toBe('INV-001');

    const stored = await getInvoice(business.id, draft.id);
    expect(stored!.number).toBe('INV-001');
  });

  it('gives consecutive numbers to consecutive invoices', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const numbers: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const d = await draftFor(business, uid);
      const { invoice } = await issueInvoice({ business, uid, invoiceId: d.id });
      numbers.push(invoice.number!);
    }
    expect(numbers).toEqual(['INV-001', 'INV-002', 'INV-003']);
  });

  it('never reissues or renumbers an already-issued invoice', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const draft = await draftFor(business, uid);
    const first = await issueInvoice({ business, uid, invoiceId: draft.id });
    const second = await issueInvoice({ business, uid, invoiceId: draft.id });
    expect(second.alreadyIssued).toBe(true);
    expect(second.invoice.number).toBe(first.invoice.number);
    expect(second.invoice.issued!.issuedAt).toBe(first.invoice.issued!.issuedAt);
  });

  it('refuses to edit an issued invoice', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const draft = await draftFor(business, uid);
    const { invoice } = await issueInvoice({ business, uid, invoiceId: draft.id });

    await expect(
      saveDraft({
        business,
        uid,
        invoiceId: invoice.id,
        kind: 'customer-invoice',
        issueDate: todayIst(),
        customer: emptyParty('Changed'),
        placeOfSupplyStateCode: '27',
        supplyFlags: [],
        lines: [line('Sneaky change', '1', '99999', '18')],
        notes: null,
        baseRevision: invoice.revision,
      }),
    ).rejects.toBeInstanceOf(InvoiceStateError);
  });

  /**
   * GATE: "issued history remains unchanged after profile edits".
   */
  it('keeps the issued snapshot after the business profile changes', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const draft = await draftFor(business, uid);
    const { invoice } = await issueInvoice({ business, uid, invoiceId: draft.id });

    await updateBusiness(business.id, uid, {
      legalName: 'Renamed Services Pvt Ltd',
      addressLine1: 'A completely different address',
      gstin: '29AAGCB7383J1Z4',
      stateCode: '29',
    });

    const after = await getInvoice(business.id, invoice.id);
    expect(after!.issued!.seller.legalName).toBe('Test Services');
    expect(after!.issued!.seller.addressLine1).toBe('1 Test Lane');
    expect(after!.issued!.seller.gstin).toBe('27AAPFU0939F1ZV');
    expect(after!.totals.grandTotalPaise).toBe(241900);
    expect(after!.number).toBe('INV-001');
  });

  /**
   * GATE: "unsupported cases cannot issue".
   */
  it('blocks issuance for an unsupported supply but preserves the draft', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const draft = await saveDraft({
      business,
      uid,
      invoiceId: newInvoiceId(),
      kind: 'customer-invoice',
      issueDate: todayIst(),
      customer: emptyParty('Overseas Buyer'),
      placeOfSupplyStateCode: '27',
      supplyFlags: ['export'],
      lines: [line('Consulting', '1', '5000', '18')],
      notes: null,
      baseRevision: 0,
    });

    await expect(issueInvoice({ business, uid, invoiceId: draft.id })).rejects.toBeInstanceOf(IssuanceBlockedError);

    const still = await getInvoice(business.id, draft.id);
    expect(still!.status).toBe('draft');
    expect(still!.lines).toHaveLength(1);
  });

  it('blocks a business that has not confirmed its GST status', async () => {
    const business = await makeGstBusiness({ registrationType: 'not-sure' });
    const uid = await ownerUidOf(business);
    const draft = await draftFor(business, uid, '0');
    await expect(issueInvoice({ business, uid, invoiceId: draft.id })).rejects.toThrow(/GST status/i);
  });

  it('lets an unregistered business issue without any GST', async () => {
    const business = await makeUnregisteredBusiness();
    const uid = await ownerUidOf(business);
    const draft = await saveDraft({
      business,
      uid,
      invoiceId: newInvoiceId(),
      kind: 'quick-bill',
      issueDate: todayIst(),
      customer: emptyParty(),
      placeOfSupplyStateCode: null,
      supplyFlags: [],
      lines: [line('Tiffin service', '1', '2050', '0')],
      notes: null,
      baseRevision: 0,
    });
    const { invoice } = await issueInvoice({ business, uid, invoiceId: draft.id });
    expect(invoice.issued!.documentTitle).toBe('Invoice');
    expect(invoice.totals.totalTaxPaise).toBe(0);
    expect(invoice.totals.grandTotalPaise).toBe(205000);
  });
});

describe('duplicate', () => {
  it('creates a clean draft without copying number, payment state or schedule', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const draft = await draftFor(business, uid);
    const { invoice } = await issueInvoice({ business, uid, invoiceId: draft.id });

    const copy = await duplicateInvoice({ business, uid, sourceInvoiceId: invoice.id });

    expect(copy.id).not.toBe(invoice.id);
    expect(copy.status).toBe('draft');
    expect(copy.number).toBeNull();
    expect(copy.issued).toBeNull();
    expect(copy.paymentStatus).toBe('unpaid');
    expect(copy.amountPaidPaise).toBe(0);
    expect(copy.scheduleId).toBeNull();
    expect(copy.occurrenceKey).toBeNull();
    expect(copy.billingPeriod).toBeNull();
    expect(copy.duplicatedFromInvoiceId).toBe(invoice.id);
    // Items carry over, with fresh line ids.
    expect(copy.lines.map((l) => l.description)).toEqual(['Repair visit', 'Spare parts']);
    expect(copy.lines[0]!.id).not.toBe(invoice.lines[0]!.id);
  });
});

// ---------------------------------------------------------------------------
// A tax invoice that charges no GST because nobody answered the rate question
// is a wrong document, and it goes on to enter GSTR-1 as a nil-rated supply.
// 0% is a legal answer, so the rate cannot be judged by its value alone.
// ---------------------------------------------------------------------------

describe('a rate nobody chose', () => {
  async function draftWithUnansweredRate() {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const draft = await saveDraft({
      business,
      uid,
      invoiceId: newInvoiceId(),
      kind: 'customer-invoice',
      issueDate: todayIst(),
      customer: { ...emptyParty('Sharma Electricals'), stateCode: '27' },
      placeOfSupplyStateCode: '27',
      supplyFlags: [],
      lines: [line('Repair visit', '2', '800', '0', { taxRateChosen: false })],
      notes: null,
      baseRevision: 0,
    });
    return { business, uid, draft };
  }

  it('saves the draft, so nothing the owner typed is lost', async () => {
    const { draft } = await draftWithUnansweredRate();
    expect(draft.status).toBe('draft');
    expect(draft.lines[0]!.taxRateChosen).toBe(false);
  });

  it('refuses to issue it, and says which item to fix', async () => {
    const { business, uid, draft } = await draftWithUnansweredRate();
    await expect(issueInvoice({ business, uid, invoiceId: draft.id })).rejects.toBeInstanceOf(IssuanceBlockedError);
    try {
      await issueInvoice({ business, uid, invoiceId: draft.id });
    } catch (e) {
      const blockers = (e as IssuanceBlockedError).blockers;
      expect(blockers.map((b) => b.code)).toContain('rate-not-chosen');
      expect(blockers.find((b) => b.code === 'rate-not-chosen')!.whatYouCanDo).toMatch(/choose 0%/i);
    }
  });

  it('issues once the owner deliberately chooses 0%', async () => {
    const { business, uid, draft } = await draftWithUnansweredRate();
    const answered = await saveDraft({
      business,
      uid,
      invoiceId: draft.id,
      kind: 'customer-invoice',
      issueDate: draft.issueDate,
      customer: draft.customer,
      placeOfSupplyStateCode: '27',
      supplyFlags: [],
      lines: [line('Repair visit', '2', '800', '0', { taxRateChosen: true })],
      notes: null,
      baseRevision: draft.revision,
    });
    const { invoice } = await issueInvoice({ business, uid, invoiceId: answered.id });
    expect(invoice.status).toBe('issued');
    expect(invoice.totals.totalTaxPaise).toBe(0);
    expect(invoice.totals.grandTotalPaise).toBe(160000);
  });

  it('never asks a business that adds no GST', async () => {
    const business = await makeUnregisteredBusiness();
    const uid = await ownerUidOf(business);
    const draft = await saveDraft({
      business,
      uid,
      invoiceId: newInvoiceId(),
      kind: 'quick-bill',
      issueDate: todayIst(),
      customer: emptyParty('Walk-in customer'),
      placeOfSupplyStateCode: null,
      supplyFlags: [],
      lines: [line('Repair visit', '2', '800', '0', { taxRateChosen: false })],
      notes: null,
      baseRevision: 0,
    });
    const { invoice } = await issueInvoice({ business, uid, invoiceId: draft.id });
    expect(invoice.status).toBe('issued');
  });
});
