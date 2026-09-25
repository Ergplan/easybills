import { describe, expect, it } from 'vitest';

import { todayIst } from '@/lib/dates';
import { auditCol } from '@/server/firebase/paths';
import { AdjustmentError, createAdjustment, listAdjustmentsForInvoice } from '@/server/repos/adjustments';
import { emptyParty, getInvoice, issueInvoice, newInvoiceId, saveDraft } from '@/server/repos/invoices';
import { recordPayment } from '@/server/repos/payments';

import { line, makeGstBusiness, ownerUidOf } from '../helpers';

async function issued(amount = '1000') {
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
    lines: [line('Consulting', '1', amount, '0')],
    notes: null,
    baseRevision: 0,
  });
  const { invoice } = await issueInvoice({ business, uid, invoiceId: draft.id });
  return { business, uid, invoice };
}

describe('credit notes', () => {
  it('reduces what the customer owes without touching the issued bill', async () => {
    const { business, uid, invoice } = await issued('1000');

    const note = await createAdjustment({
      business,
      uid,
      invoiceId: invoice.id,
      kind: 'credit-note',
      amountPaise: 20000,
      reason: 'One visit was billed twice',
      affectsTaxLiability: false,
    });

    expect(note.number).toBe('CN-001');
    expect(note.status).toBe('issued');

    const after = await getInvoice(business.id, invoice.id)!;
    expect(after!.creditAppliedPaise).toBe(20000);
    expect(after!.balancePaise).toBe(80000);
    // The bill itself is untouched: same total, same number, same snapshot.
    expect(after!.totals.grandTotalPaise).toBe(100000);
    expect(after!.number).toBe(invoice.number);
    expect(after!.issued!.issuedAt).toBe(invoice.issued!.issuedAt);
  });

  it('numbers notes in their own sequence', async () => {
    const { business, uid, invoice } = await issued('1000');
    const a = await createAdjustment({
      business, uid, invoiceId: invoice.id, kind: 'credit-note',
      amountPaise: 10000, reason: 'first', affectsTaxLiability: false,
    });
    const b = await createAdjustment({
      business, uid, invoiceId: invoice.id, kind: 'credit-note',
      amountPaise: 10000, reason: 'second', affectsTaxLiability: false,
    });
    expect([a.number, b.number]).toEqual(['CN-001', 'CN-002']);
    // Debit notes have a sequence of their own.
    const d = await createAdjustment({
      business, uid, invoiceId: invoice.id, kind: 'debit-note',
      amountPaise: 5000, reason: 'extra work', affectsTaxLiability: false,
    });
    expect(d.number).toBe('DN-001');
  });

  it('refuses a credit note larger than the bill it corrects', async () => {
    const { business, uid, invoice } = await issued('1000');
    await expect(
      createAdjustment({
        business, uid, invoiceId: invoice.id, kind: 'credit-note',
        amountPaise: 200000, reason: 'too much', affectsTaxLiability: false,
      }),
    ).rejects.toBeInstanceOf(AdjustmentError);
  });

  it('refuses a note against a draft', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const draft = await saveDraft({
      business, uid, invoiceId: newInvoiceId(), kind: 'customer-invoice',
      issueDate: todayIst(), customer: emptyParty('Someone'), placeOfSupplyStateCode: '27',
      supplyFlags: [], lines: [line('Work', '1', '100', '0')], notes: null, baseRevision: 0,
    });
    await expect(
      createAdjustment({
        business, uid, invoiceId: draft.id, kind: 'credit-note',
        amountPaise: 1000, reason: 'x', affectsTaxLiability: false,
      }),
    ).rejects.toThrow(/has been issued/i);
  });

  it('requires a reason', async () => {
    const { business, uid, invoice } = await issued('1000');
    await expect(
      createAdjustment({
        business, uid, invoiceId: invoice.id, kind: 'credit-note',
        amountPaise: 1000, reason: '   ', affectsTaxLiability: false,
      }),
    ).rejects.toThrow(/why/i);
  });

  /**
   * The distinction the product must not blur: adjusting a customer's balance
   * and adjusting a tax liability are separate assertions by the owner.
   */
  it('keeps a customer-balance correction separate from a tax-liability change', async () => {
    const { business, uid, invoice } = await issued('1000');

    const balanceOnly = await createAdjustment({
      business, uid, invoiceId: invoice.id, kind: 'credit-note',
      amountPaise: 10000, reason: 'goodwill discount after the fact', affectsTaxLiability: false,
    });
    expect(balanceOnly.affectsTaxLiability).toBe(false);
    // No tax is carried when the owner did not claim a liability change.
    expect(balanceOnly.cgstPaise).toBe(0);
    expect(balanceOnly.sgstPaise).toBe(0);
    expect(balanceOnly.taxableValuePaise).toBe(0);

    const taxChanging = await createAdjustment({
      business, uid, invoiceId: invoice.id, kind: 'credit-note',
      amountPaise: 11800, reason: 'item returned', affectsTaxLiability: true,
      tax: { taxableValuePaise: 10000, cgstPaise: 900, sgstPaise: 900, igstPaise: 0, cessPaise: 0 },
    });
    expect(taxChanging.affectsTaxLiability).toBe(true);
    expect(taxChanging.cgstPaise).toBe(900);
  });

  it('records reason, actor and time in the audit trail', async () => {
    const { business, uid, invoice } = await issued('1000');
    await createAdjustment({
      business, uid, invoiceId: invoice.id, kind: 'credit-note',
      amountPaise: 10000, reason: 'billed twice', affectsTaxLiability: false,
    });
    const audit = await auditCol(business.id).where('action', '==', 'adjustment.credit-note').get();
    expect(audit.size).toBe(1);
    const event = audit.docs[0]!.data();
    expect(event.actorUid).toBe(uid);
    expect(event.detail.reason).toBe('billed twice');
    expect(event.at).toBeTruthy();
  });
});

describe('debit notes', () => {
  it('increases what the customer owes', async () => {
    const { business, uid, invoice } = await issued('1000');
    await createAdjustment({
      business, uid, invoiceId: invoice.id, kind: 'debit-note',
      amountPaise: 25000, reason: 'extra parts supplied', affectsTaxLiability: false,
    });
    const after = await getInvoice(business.id, invoice.id);
    expect(after!.debitAppliedPaise).toBe(25000);
    expect(after!.balancePaise).toBe(125000);
    expect(after!.paymentStatus).toBe('unpaid');
  });
});

describe('notes and payments together', () => {
  it('settles a bill when a payment plus a credit note cover it', async () => {
    const { business, uid, invoice } = await issued('1000');

    await recordPayment({
      businessId: business.id, uid, customerId: null, receivedOn: todayIst(),
      amountPaise: 80000, method: 'upi', reference: null, note: null,
      allocations: [{ invoiceId: invoice.id, amountPaise: 80000 }],
    });
    let after = await getInvoice(business.id, invoice.id);
    expect(after!.paymentStatus).toBe('partly-paid');

    await createAdjustment({
      business, uid, invoiceId: invoice.id, kind: 'credit-note',
      amountPaise: 20000, reason: 'agreed reduction', affectsTaxLiability: false,
    });
    after = await getInvoice(business.id, invoice.id);
    expect(after!.balancePaise).toBe(0);
    expect(after!.paymentStatus).toBe('paid');
    // A credit note is not money: the received figure is unchanged.
    expect(after!.amountPaidPaise).toBe(80000);
  });

  it('lists notes against the bill they correct', async () => {
    const { business, uid, invoice } = await issued('1000');
    await createAdjustment({
      business, uid, invoiceId: invoice.id, kind: 'credit-note',
      amountPaise: 10000, reason: 'a', affectsTaxLiability: false,
    });
    await createAdjustment({
      business, uid, invoiceId: invoice.id, kind: 'debit-note',
      amountPaise: 5000, reason: 'b', affectsTaxLiability: false,
    });
    const notes = await listAdjustmentsForInvoice(business.id, invoice.id);
    expect(notes).toHaveLength(2);
    expect(notes.every((n) => n.invoiceId === invoice.id)).toBe(true);
  });
});
