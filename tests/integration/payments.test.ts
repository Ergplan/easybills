import { describe, expect, it } from 'vitest';

import { todayIst } from '@/lib/dates';
import { auditCol } from '@/server/firebase/paths';
import {
  PaymentError,
  customerUnappliedCredit,
  listPaymentsForInvoice,
  recordPayment,
  recordSettlementDeduction,
  reversePayment,
} from '@/server/repos/payments';
import { emptyParty, getInvoice, issueInvoice, newInvoiceId, saveDraft } from '@/server/repos/invoices';
import { createCustomer } from '@/server/repos/customers';

import { line, makeGstBusiness, ownerUidOf } from '../helpers';

async function issuedInvoice(amount = '1000', customerId: string | null = null) {
  const business = await makeGstBusiness();
  const uid = await ownerUidOf(business);
  const draft = await saveDraft({
    business,
    uid,
    invoiceId: newInvoiceId(),
    kind: 'customer-invoice',
    issueDate: todayIst(),
    customer: { ...emptyParty('Sharma Electricals'), customerId },
    placeOfSupplyStateCode: '27',
    supplyFlags: [],
    lines: [line('Consulting', '1', amount, '0')],
    notes: null,
    baseRevision: 0,
  });
  const { invoice } = await issueInvoice({ business, uid, invoiceId: draft.id });
  return { business, uid, invoice };
}

describe('payments', () => {
  it('marks an invoice paid when the full amount is allocated', async () => {
    const { business, uid, invoice } = await issuedInvoice('1000');
    expect(invoice.balancePaise).toBe(100000);

    await recordPayment({
      businessId: business.id,
      uid,
      customerId: null,
      receivedOn: todayIst(),
      amountPaise: 100000,
      method: 'upi',
      reference: 'UPI-123',
      note: null,
      allocations: [{ invoiceId: invoice.id, amountPaise: 100000 }],
    });

    const after = await getInvoice(business.id, invoice.id);
    expect(after!.amountPaidPaise).toBe(100000);
    expect(after!.balancePaise).toBe(0);
    expect(after!.paymentStatus).toBe('paid');
  });

  it('shows partly paid from actual ledger rows', async () => {
    const { business, uid, invoice } = await issuedInvoice('1000');
    await recordPayment({
      businessId: business.id,
      uid,
      customerId: null,
      receivedOn: todayIst(),
      amountPaise: 40000,
      method: 'cash',
      reference: null,
      note: null,
      allocations: [{ invoiceId: invoice.id, amountPaise: 40000 }],
    });
    const after = await getInvoice(business.id, invoice.id);
    expect(after!.paymentStatus).toBe('partly-paid');
    expect(after!.balancePaise).toBe(60000);
  });

  /**
   * "Define overpayments explicitly as unapplied credit or reject allocation
   * beyond the balance; do not silently discard them."  We do both: allocation
   * beyond the balance is rejected, and an unallocated excess is retained as
   * visible credit.
   */
  it('rejects an allocation larger than the outstanding balance', async () => {
    const { business, uid, invoice } = await issuedInvoice('1000');
    await expect(
      recordPayment({
        businessId: business.id,
        uid,
        customerId: null,
        receivedOn: todayIst(),
        amountPaise: 150000,
        method: 'cash',
        reference: null,
        note: null,
        allocations: [{ invoiceId: invoice.id, amountPaise: 150000 }],
      }),
    ).rejects.toBeInstanceOf(PaymentError);

    const after = await getInvoice(business.id, invoice.id);
    expect(after!.amountPaidPaise).toBe(0);
    expect(after!.paymentStatus).toBe('unpaid');
  });

  it('keeps an unallocated excess as visible customer credit', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const customer = await createCustomer(business.id, uid, {
      name: 'Regular Customer',
      phone: null,
      email: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      pincode: null,
      stateCode: '27',
      gstin: null,
      pan: null,
      notes: null,
    });
    const draft = await saveDraft({
      business,
      uid,
      invoiceId: newInvoiceId(),
      kind: 'customer-invoice',
      issueDate: todayIst(),
      customer: { ...emptyParty(customer.name), customerId: customer.id },
      placeOfSupplyStateCode: '27',
      supplyFlags: [],
      lines: [line('Consulting', '1', '1000', '0')],
      notes: null,
      baseRevision: 0,
    });
    const { invoice } = await issueInvoice({ business, uid, invoiceId: draft.id });

    const payment = await recordPayment({
      businessId: business.id,
      uid,
      customerId: customer.id,
      receivedOn: todayIst(),
      amountPaise: 150000,
      method: 'upi',
      reference: null,
      note: null,
      allocations: [{ invoiceId: invoice.id, amountPaise: 100000 }],
    });

    expect(payment.unappliedPaise).toBe(50000);
    expect(await customerUnappliedCredit(business.id, customer.id)).toBe(50000);
    const after = await getInvoice(business.id, invoice.id);
    expect(after!.paymentStatus).toBe('paid');
  });

  it('refuses payment against a draft', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const draft = await saveDraft({
      business,
      uid,
      invoiceId: newInvoiceId(),
      kind: 'customer-invoice',
      issueDate: todayIst(),
      customer: emptyParty('Someone'),
      placeOfSupplyStateCode: '27',
      supplyFlags: [],
      lines: [line('Work', '1', '100', '0')],
      notes: null,
      baseRevision: 0,
    });
    await expect(
      recordPayment({
        businessId: business.id,
        uid,
        customerId: null,
        receivedOn: todayIst(),
        amountPaise: 10000,
        method: 'cash',
        reference: null,
        note: null,
        allocations: [{ invoiceId: draft.id, amountPaise: 10000 }],
      }),
    ).rejects.toThrow(/issued bill/i);
  });
});

describe('reversals', () => {
  /**
   * GATE: "payment reversals preserve audit history".
   */
  it('preserves the original payment and records a mirror row', async () => {
    const { business, uid, invoice } = await issuedInvoice('1000');
    const payment = await recordPayment({
      businessId: business.id,
      uid,
      customerId: null,
      receivedOn: todayIst(),
      amountPaise: 100000,
      method: 'cheque',
      reference: 'CHQ-9',
      note: null,
      allocations: [{ invoiceId: invoice.id, amountPaise: 100000 }],
    });

    const reversal = await reversePayment({
      businessId: business.id,
      uid,
      paymentId: payment.id,
      reason: 'Cheque bounced',
      reversedOn: todayIst(),
    });

    expect(reversal.amountPaise).toBe(-100000);
    expect(reversal.reversalOfPaymentId).toBe(payment.id);

    const history = await listPaymentsForInvoice(business.id, invoice.id);
    expect(history).toHaveLength(2);
    // The original row is still there, now marked as reversed.
    const original = history.find((p) => p.id === payment.id)!;
    expect(original.amountPaise).toBe(100000);
    expect(original.reversedByPaymentId).toBe(reversal.id);

    const after = await getInvoice(business.id, invoice.id);
    expect(after!.amountPaidPaise).toBe(0);
    expect(after!.paymentStatus).toBe('unpaid');
    expect(after!.balancePaise).toBe(100000);

    const audit = await auditCol(business.id).where('action', '==', 'payment.reversed').get();
    expect(audit.size).toBe(1);
  });

  it('refuses to reverse the same payment twice', async () => {
    const { business, uid, invoice } = await issuedInvoice('1000');
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
    await reversePayment({ businessId: business.id, uid, paymentId: payment.id, reason: 'x', reversedOn: todayIst() });
    await expect(
      reversePayment({ businessId: business.id, uid, paymentId: payment.id, reason: 'again', reversedOn: todayIst() }),
    ).rejects.toThrow(/already been reversed/i);
  });
});

describe('settlement deductions', () => {
  /**
   * A deduction such as owner-confirmed TDS reduces what is still to be collected
   * WITHOUT being treated as cash received and WITHOUT touching the invoice total
   * (and therefore without changing the tax reported on the invoice).
   */
  it('reduces the balance without counting as cash or as a discount', async () => {
    const { business, uid, invoice } = await issuedInvoice('1000');

    await recordSettlementDeduction({
      businessId: business.id,
      uid,
      invoiceId: invoice.id,
      amountPaise: 10000,
      reason: 'TDS withheld by customer, certificate received',
      onDate: todayIst(),
    });

    const after = await getInvoice(business.id, invoice.id);
    expect(after!.settlementDeductionPaise).toBe(10000);
    expect(after!.amountPaidPaise).toBe(0); // not cash
    expect(after!.totals.grandTotalPaise).toBe(100000); // total unchanged
    expect(after!.balancePaise).toBe(90000);
    expect(after!.paymentStatus).toBe('partly-paid');

    // Paying the remaining balance settles the invoice.
    await recordPayment({
      businessId: business.id,
      uid,
      customerId: null,
      receivedOn: todayIst(),
      amountPaise: 90000,
      method: 'bank-transfer',
      reference: null,
      note: null,
      allocations: [{ invoiceId: invoice.id, amountPaise: 90000 }],
    });
    const settled = await getInvoice(business.id, invoice.id);
    expect(settled!.paymentStatus).toBe('paid');
    expect(settled!.balancePaise).toBe(0);
  });

  it('refuses a deduction larger than the outstanding balance', async () => {
    const { business, uid, invoice } = await issuedInvoice('1000');
    await expect(
      recordSettlementDeduction({
        businessId: business.id,
        uid,
        invoiceId: invoice.id,
        amountPaise: 200000,
        reason: 'too much',
        onDate: todayIst(),
      }),
    ).rejects.toBeInstanceOf(PaymentError);
  });
});
