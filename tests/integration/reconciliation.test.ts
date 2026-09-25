import { describe, expect, it } from 'vitest';

import { todayIst } from '@/lib/dates';
import { formatMoneyIndian } from '@/lib/money';
import { updateBusiness } from '@/server/repos/business';
import { createAdjustment } from '@/server/repos/adjustments';
import { emptyParty, getInvoice, issueInvoice, newInvoiceId, saveDraft } from '@/server/repos/invoices';
import {
  customerUnappliedCredit,
  recordPayment,
  recordSettlementDeduction,
  reversePayment,
} from '@/server/repos/payments';
import { createCustomer } from '@/server/repos/customers';
import { renderInvoiceHtml } from '@/server/pdf/template';
import { preparePeriod } from '@/server/gst/prepare';

import { line, makeGstBusiness, ownerUidOf } from '../helpers';

/**
 * The invariant the whole ledger rests on:
 *
 *   balance = total + debit notes - credit notes - payments - deductions
 *
 * It is asserted after every single operation below, not just at the end,
 * because a ledger that only balances at the end has been wrong in between.
 */
function expectBalanceInvariant(inv: NonNullable<Awaited<ReturnType<typeof getInvoice>>>) {
  const expected =
    inv.totals.grandTotalPaise +
    inv.debitAppliedPaise -
    inv.creditAppliedPaise -
    inv.amountPaidPaise -
    inv.settlementDeductionPaise;
  expect(inv.balancePaise).toBe(expected);

  // ...and the derived status must agree with the arithmetic.
  if (inv.balancePaise <= 0) expect(inv.paymentStatus).toBe('paid');
  else if (inv.balancePaise < inv.totals.grandTotalPaise) expect(inv.paymentStatus).toBe('partly-paid');
  else expect(inv.paymentStatus).toBe('unpaid');
}

describe('money reconciles through a full lifecycle', () => {
  it('holds the balance invariant after every operation', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const customer = await createCustomer(business.id, uid, {
      name: 'Long Story Ltd', phone: null, email: null, addressLine1: null, addressLine2: null,
      city: null, pincode: null, stateCode: '27', gstin: null, pan: null, notes: null,
    });

    // 10,000 + 18% = 11,800
    const draft = await saveDraft({
      business, uid, invoiceId: newInvoiceId(), kind: 'customer-invoice', issueDate: todayIst(),
      customer: { ...emptyParty(customer.name), customerId: customer.id, stateCode: '27' },
      placeOfSupplyStateCode: '27', supplyFlags: [],
      lines: [line('Consulting', '1', '10000', '18')], notes: null, baseRevision: 0,
    });
    const { invoice } = await issueInvoice({ business, uid, invoiceId: draft.id });
    expect(invoice.totals.grandTotalPaise).toBe(1_180_000);
    expectBalanceInvariant(invoice);

    const step = async () => {
      const i = await getInvoice(business.id, invoice.id);
      expectBalanceInvariant(i!);
      return i!;
    };

    // 1. Part payment of 5,000 -> 6,800 left
    await recordPayment({
      businessId: business.id, uid, customerId: customer.id, receivedOn: todayIst(),
      amountPaise: 500_000, method: 'upi', reference: null, note: null,
      allocations: [{ invoiceId: invoice.id, amountPaise: 500_000 }],
    });
    expect((await step()).balancePaise).toBe(680_000);

    // 2. Debit note of 1,000 -> 7,800 left
    await createAdjustment({
      business, uid, invoiceId: invoice.id, kind: 'debit-note',
      amountPaise: 100_000, reason: 'extra day', affectsTaxLiability: false,
    });
    expect((await step()).balancePaise).toBe(780_000);

    // 3. Credit note of 800 -> 7,000 left
    await createAdjustment({
      business, uid, invoiceId: invoice.id, kind: 'credit-note',
      amountPaise: 80_000, reason: 'agreed reduction', affectsTaxLiability: false,
    });
    expect((await step()).balancePaise).toBe(700_000);

    // 4. TDS-style deduction of 1,000 -> 6,000 left, and NOT counted as cash
    await recordSettlementDeduction({
      businessId: business.id, uid, invoiceId: invoice.id,
      amountPaise: 100_000, reason: 'TDS withheld', onDate: todayIst(),
    });
    const afterDeduction = await step();
    expect(afterDeduction.balancePaise).toBe(600_000);
    expect(afterDeduction.amountPaidPaise).toBe(500_000);

    // 5. Second payment settles it exactly
    const second = await recordPayment({
      businessId: business.id, uid, customerId: customer.id, receivedOn: todayIst(),
      amountPaise: 600_000, method: 'bank-transfer', reference: null, note: null,
      allocations: [{ invoiceId: invoice.id, amountPaise: 600_000 }],
    });
    const settled = await step();
    expect(settled.balancePaise).toBe(0);
    expect(settled.paymentStatus).toBe('paid');

    // 6. Reversing the second payment puts the debt back, exactly
    await reversePayment({
      businessId: business.id, uid, paymentId: second.id, reason: 'bounced', reversedOn: todayIst(),
    });
    const reversed = await step();
    expect(reversed.balancePaise).toBe(600_000);
    expect(reversed.paymentStatus).toBe('partly-paid');

    // The issued document itself never moved through any of that.
    expect(reversed.totals.grandTotalPaise).toBe(1_180_000);
    expect(reversed.number).toBe(invoice.number);
    expect(reversed.issued!.issuedAt).toBe(invoice.issued!.issuedAt);
  });

  it('keeps an overpayment as visible credit rather than losing it', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const customer = await createCustomer(business.id, uid, {
      name: 'Generous Ltd', phone: null, email: null, addressLine1: null, addressLine2: null,
      city: null, pincode: null, stateCode: '27', gstin: null, pan: null, notes: null,
    });
    const draft = await saveDraft({
      business, uid, invoiceId: newInvoiceId(), kind: 'customer-invoice', issueDate: todayIst(),
      customer: { ...emptyParty(customer.name), customerId: customer.id },
      placeOfSupplyStateCode: '27', supplyFlags: [],
      lines: [line('Work', '1', '1000', '0')], notes: null, baseRevision: 0,
    });
    const { invoice } = await issueInvoice({ business, uid, invoiceId: draft.id });

    await recordPayment({
      businessId: business.id, uid, customerId: customer.id, receivedOn: todayIst(),
      amountPaise: 150_000, method: 'upi', reference: null, note: null,
      allocations: [{ invoiceId: invoice.id, amountPaise: 100_000 }],
    });

    expectBalanceInvariant((await getInvoice(business.id, invoice.id))!);
    // The 500 extra is credit sitting with the customer, not vanished.
    expect(await customerUnappliedCredit(business.id, customer.id)).toBe(50_000);
  });
});

describe('the screen, the document and the return agree', () => {
  it('prints the same total the ledger holds', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const draft = await saveDraft({
      business, uid, invoiceId: newInvoiceId(), kind: 'customer-invoice', issueDate: todayIst(),
      customer: { ...emptyParty('Print Check Ltd'), stateCode: '27' },
      placeOfSupplyStateCode: '27', supplyFlags: [],
      lines: [line('Consulting', '3', '3333.33', '18')], notes: null, baseRevision: 0,
    });
    const { invoice } = await issueInvoice({ business, uid, invoiceId: draft.id });
    const html = renderInvoiceHtml(invoice);

    // Every figure on the document comes from the same stored totals.
    expect(html).toContain(formatMoneyIndian(invoice.totals.grandTotalPaise, { withSymbol: true }));
    expect(html).toContain(formatMoneyIndian(invoice.totals.taxableValuePaise));
    expect(html).toContain(formatMoneyIndian(invoice.totals.cgstPaise));
    expect(html).toContain(invoice.number!);
  });

  /**
   * The cross-check that matters most: the GST return's outward tax must equal
   * the tax on the invoices it was built from. If these ever disagree, one of
   * them is a wrong number an owner might file.
   */
  it('reports exactly the tax the issued invoices carry', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const configured = await updateBusiness(business.id, uid, {
      gstReturns: {
        gstin: '27AAPFU0939F1ZV', registrationType: 'regular', filingFrequency: 'monthly',
        usesIff: false, filingStartPeriod: '2026-09', previouslyFiledPeriods: [],
        source: 'owner-declared', confirmedAt: new Date().toISOString(), confirmedByUid: uid,
      },
    });

    const amounts: Array<[string, string, string]> = [
      ['10000', '18', '27'], // intra-state
      ['5000', '18', '29'],  // inter-state -> IGST
      ['2500', '5', '27'],
      ['999.99', '12', '27'],
    ];

    let expectedCgst = 0, expectedSgst = 0, expectedIgst = 0, expectedTaxable = 0;

    for (const [amount, rate, pos] of amounts) {
      const d = await saveDraft({
        business: configured, uid, invoiceId: newInvoiceId(), kind: 'customer-invoice',
        issueDate: '2026-09-15',
        customer: { ...emptyParty('A Customer'), stateCode: pos },
        placeOfSupplyStateCode: pos, supplyFlags: [],
        lines: [line('Work', '1', amount, rate)], notes: null, baseRevision: 0,
      });
      const { invoice } = await issueInvoice({ business: configured, uid, invoiceId: d.id });
      expectedTaxable += invoice.totals.taxableValuePaise;
      expectedCgst += invoice.totals.cgstPaise;
      expectedSgst += invoice.totals.sgstPaise;
      expectedIgst += invoice.totals.igstPaise;
    }

    const prepared = await preparePeriod({ business: configured, period: '2026-09' });

    expect(prepared.gstr1.totals.taxableValuePaise).toBe(expectedTaxable);
    expect(prepared.gstr1.totals.cgstPaise).toBe(expectedCgst);
    expect(prepared.gstr1.totals.sgstPaise).toBe(expectedSgst);
    expect(prepared.gstr1.totals.igstPaise).toBe(expectedIgst);

    // GSTR-3B's outward liability is the same money, so it must match too.
    expect(prepared.gstr3b.outward.cgstPaise).toBe(expectedCgst);
    expect(prepared.gstr3b.outward.sgstPaise).toBe(expectedSgst);
    expect(prepared.gstr3b.outward.igstPaise).toBe(expectedIgst);

    // Heads stay separate: an interstate sale contributes to IGST only.
    expect(expectedIgst).toBeGreaterThan(0);
    expect(expectedCgst).toBe(expectedSgst);
  });

  it('leaves a draft out of the return entirely', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const configured = await updateBusiness(business.id, uid, {
      gstReturns: {
        gstin: '27AAPFU0939F1ZV', registrationType: 'regular', filingFrequency: 'monthly',
        usesIff: false, filingStartPeriod: '2026-09', previouslyFiledPeriods: [],
        source: 'owner-declared', confirmedAt: new Date().toISOString(), confirmedByUid: uid,
      },
    });
    await saveDraft({
      business: configured, uid, invoiceId: newInvoiceId(), kind: 'customer-invoice',
      issueDate: '2026-09-15', customer: emptyParty('Never Issued'),
      placeOfSupplyStateCode: '27', supplyFlags: [],
      lines: [line('Phantom', '1', '999999', '18')], notes: null, baseRevision: 0,
    });

    const prepared = await preparePeriod({ business: configured, period: '2026-09' });
    expect(prepared.gstr1.totals.taxableValuePaise).toBe(0);
    expect(prepared.summary.salesCount).toBe(0);
  });
});
