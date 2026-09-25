import 'server-only';

import { randomUUID } from 'node:crypto';

import type { CivilDate } from '@/lib/dates';
import type {
  AdjustmentRecord,
  InvoiceRecord,
  PaymentAllocation,
  PaymentMethod,
  PaymentRecord,
} from '@/lib/domain/types';
import { db } from '@/server/firebase/admin';
import { adjustmentsCol, idempotentId, invoicesCol, paymentsCol } from '@/server/firebase/paths';
import { recordAuditInTransaction } from '@/server/services/audit';
import { computeBalance, paymentStatusFor } from '@/server/services/invoice-calc';

export class PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentError';
  }
}

/**
 * Record money received.
 *
 * Two rules this enforces, both of which are easy to get quietly wrong:
 *
 *  1. OVERPAYMENT IS NEVER DISCARDED. An allocation may not exceed an invoice's
 *     outstanding balance. Anything the owner received beyond what they allocated
 *     is stored as `unappliedPaise` -- visible credit sitting with the customer --
 *     rather than being silently absorbed into a "paid" flag.
 *
 *  2. THE INVOICE'S STATE IS DERIVED, NOT ASSERTED. Paid / partly paid / unpaid
 *     comes from the arithmetic on actual ledger rows, in the same transaction
 *     that writes them, so a balance can never drift from its payments.
 */
export async function recordPayment(args: {
  businessId: string;
  uid: string;
  customerId: string | null;
  receivedOn: CivilDate;
  amountPaise: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  allocations: PaymentAllocation[];
  /**
   * Fixed by the caller before the first attempt, so a double tap or a retry
   * lands on the same document instead of taking the money twice. A part
   * payment is the dangerous case: a second copy of it still fits inside the
   * balance, so no amount check would catch it.
   */
  idempotencyKey?: string;
}): Promise<PaymentRecord> {
  if (args.amountPaise <= 0) throw new PaymentError('Enter an amount greater than zero.');

  const paymentRef = paymentsCol(args.businessId).doc(
    args.idempotencyKey ? idempotentId('pay', args.idempotencyKey) : randomUUID(),
  );
  const now = new Date().toISOString();

  return db().runTransaction(async (tx) => {
    // Read first, so the losing side of a race sees the winner's row rather
    // than writing its own.
    const prior = await tx.get(paymentRef);
    if (prior.exists) return prior.data() as PaymentRecord;

    const invoiceRefs = args.allocations.map((a) => invoicesCol(args.businessId).doc(a.invoiceId));
    const invoiceSnaps = invoiceRefs.length ? await tx.getAll(...invoiceRefs) : [];

    let allocatedTotal = 0;
    const updates: Array<{ ref: FirebaseFirestore.DocumentReference; invoice: InvoiceRecord; add: number }> = [];

    for (let i = 0; i < args.allocations.length; i += 1) {
      const alloc = args.allocations[i]!;
      const snap = invoiceSnaps[i]!;
      if (!snap.exists) throw new PaymentError('One of the bills no longer exists.');
      const invoice = snap.data() as InvoiceRecord;
      if (invoice.status !== 'issued') {
        throw new PaymentError(`Payment can only be recorded against an issued bill (${invoice.number ?? 'draft'}).`);
      }
      if (alloc.amountPaise <= 0) throw new PaymentError('Each allocation must be more than zero.');
      if (alloc.amountPaise > invoice.balancePaise) {
        throw new PaymentError(
          `You are applying more than is outstanding on bill ${invoice.number}. ` +
            'Reduce the amount applied, or leave the extra as credit for the customer.',
        );
      }
      allocatedTotal += alloc.amountPaise;
      updates.push({ ref: invoiceRefs[i]!, invoice, add: alloc.amountPaise });
    }

    if (allocatedTotal > args.amountPaise) {
      throw new PaymentError('You have applied more than the amount received.');
    }

    const unappliedPaise = args.amountPaise - allocatedTotal;

    const payment: PaymentRecord = {
      id: paymentRef.id,
      customerId: args.customerId,
      receivedOn: args.receivedOn,
      amountPaise: args.amountPaise,
      method: args.method,
      reference: args.reference,
      note: args.note,
      allocations: args.allocations,
      unappliedPaise,
      reversedByPaymentId: null,
      reversalOfPaymentId: null,
      createdAt: now,
      createdByUid: args.uid,
    };
    tx.set(paymentRef, payment);

    for (const u of updates) {
      const amountPaidPaise = u.invoice.amountPaidPaise + u.add;
      const balancePaise = computeBalance({
        grandTotalPaise: u.invoice.totals.grandTotalPaise,
        amountPaidPaise,
        creditAppliedPaise: u.invoice.creditAppliedPaise,
        debitAppliedPaise: u.invoice.debitAppliedPaise,
        settlementDeductionPaise: u.invoice.settlementDeductionPaise,
      });
      tx.update(u.ref, {
        amountPaidPaise,
        balancePaise,
        paymentStatus: paymentStatusFor(balancePaise, u.invoice.totals.grandTotalPaise),
        updatedAt: now,
      });
    }

    recordAuditInTransaction(tx, args.businessId, {
      actorUid: args.uid,
      actorKind: 'user',
      action: 'payment.recorded',
      subjectType: 'payment',
      subjectId: paymentRef.id,
      detail: { amountPaise: args.amountPaise, allocations: args.allocations.length, unappliedPaise },
    });

    return payment;
  });
}

/**
 * Reverse a payment.
 *
 * The original row is never edited or deleted -- it is marked as reversed and a
 * mirror-image row is written alongside it. The customer's history therefore
 * still shows that money arrived and was later reversed, which is what an owner
 * (and an auditor) needs to see.
 */
export async function reversePayment(args: {
  businessId: string;
  uid: string;
  paymentId: string;
  reason: string;
  reversedOn: CivilDate;
}): Promise<PaymentRecord> {
  const originalRef = paymentsCol(args.businessId).doc(args.paymentId);
  const reversalRef = paymentsCol(args.businessId).doc(randomUUID());
  const now = new Date().toISOString();

  return db().runTransaction(async (tx) => {
    const snap = await tx.get(originalRef);
    if (!snap.exists) throw new PaymentError('That payment no longer exists.');
    const original = snap.data() as PaymentRecord;
    if (original.reversedByPaymentId) throw new PaymentError('That payment has already been reversed.');
    if (original.reversalOfPaymentId) throw new PaymentError('A reversal cannot itself be reversed.');

    const invoiceRefs = original.allocations.map((a) => invoicesCol(args.businessId).doc(a.invoiceId));
    const invoiceSnaps = invoiceRefs.length ? await tx.getAll(...invoiceRefs) : [];

    const reversal: PaymentRecord = {
      id: reversalRef.id,
      customerId: original.customerId,
      receivedOn: args.reversedOn,
      amountPaise: -original.amountPaise,
      method: original.method,
      reference: original.reference,
      note: args.reason,
      allocations: original.allocations.map((a) => ({ invoiceId: a.invoiceId, amountPaise: -a.amountPaise })),
      unappliedPaise: -original.unappliedPaise,
      reversedByPaymentId: null,
      reversalOfPaymentId: original.id,
      createdAt: now,
      createdByUid: args.uid,
    };

    tx.set(reversalRef, reversal);
    tx.update(originalRef, { reversedByPaymentId: reversalRef.id });

    for (let i = 0; i < original.allocations.length; i += 1) {
      const snapI = invoiceSnaps[i]!;
      if (!snapI.exists) continue;
      const invoice = snapI.data() as InvoiceRecord;
      const amountPaidPaise = invoice.amountPaidPaise - original.allocations[i]!.amountPaise;
      const balancePaise = computeBalance({
        grandTotalPaise: invoice.totals.grandTotalPaise,
        amountPaidPaise,
        creditAppliedPaise: invoice.creditAppliedPaise,
        debitAppliedPaise: invoice.debitAppliedPaise,
        settlementDeductionPaise: invoice.settlementDeductionPaise,
      });
      tx.update(invoiceRefs[i]!, {
        amountPaidPaise,
        balancePaise,
        paymentStatus: paymentStatusFor(balancePaise, invoice.totals.grandTotalPaise),
        updatedAt: now,
      });
    }

    recordAuditInTransaction(tx, args.businessId, {
      actorUid: args.uid,
      actorKind: 'user',
      action: 'payment.reversed',
      subjectType: 'payment',
      subjectId: original.id,
      detail: { reversalId: reversalRef.id, amountPaise: original.amountPaise },
    });

    return reversal;
  });
}

/**
 * Record a settlement deduction, such as an owner-confirmed TDS withholding.
 *
 * This is NOT cash received and NOT a discount. It reduces what is still to be
 * collected while leaving the invoice total -- and therefore the tax reported on
 * it -- untouched. This release does not calculate the deduction for the owner;
 * they enter what the customer actually withheld.
 */
export async function recordSettlementDeduction(args: {
  businessId: string;
  uid: string;
  invoiceId: string;
  amountPaise: number;
  reason: string;
  onDate: CivilDate;
  /** See `recordPayment`. */
  idempotencyKey?: string;
}): Promise<AdjustmentRecord> {
  if (args.amountPaise <= 0) throw new PaymentError('Enter an amount greater than zero.');
  const invoiceRef = invoicesCol(args.businessId).doc(args.invoiceId);
  const adjRef = adjustmentsCol(args.businessId).doc(
    args.idempotencyKey ? idempotentId('deduct', args.idempotencyKey) : randomUUID(),
  );
  const now = new Date().toISOString();

  return db().runTransaction(async (tx) => {
    const prior = await tx.get(adjRef);
    if (prior.exists) return prior.data() as AdjustmentRecord;

    const snap = await tx.get(invoiceRef);
    if (!snap.exists) throw new PaymentError('That bill no longer exists.');
    const invoice = snap.data() as InvoiceRecord;
    if (invoice.status !== 'issued') throw new PaymentError('Only an issued bill can have a deduction recorded.');
    if (args.amountPaise > invoice.balancePaise) {
      throw new PaymentError('The deduction is more than the amount still outstanding on this bill.');
    }

    const adjustment: AdjustmentRecord = {
      id: adjRef.id,
      kind: 'settlement-deduction',
      number: null,
      financialYear: invoice.financialYear,
      invoiceId: invoice.id,
      customerId: invoice.customer.customerId,
      issueDate: args.onDate,
      reason: args.reason,
      amountPaise: args.amountPaise,
      taxableValuePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      cessPaise: 0,
      // A deduction at settlement does not by itself change GST liability.
      affectsTaxLiability: false,
      status: 'issued',
      issuedAt: now,
      createdAt: now,
      createdByUid: args.uid,
    };
    tx.set(adjRef, adjustment);

    const settlementDeductionPaise = invoice.settlementDeductionPaise + args.amountPaise;
    const balancePaise = computeBalance({
      grandTotalPaise: invoice.totals.grandTotalPaise,
      amountPaidPaise: invoice.amountPaidPaise,
      creditAppliedPaise: invoice.creditAppliedPaise,
      debitAppliedPaise: invoice.debitAppliedPaise,
      settlementDeductionPaise,
    });
    tx.update(invoiceRef, {
      settlementDeductionPaise,
      balancePaise,
      paymentStatus: paymentStatusFor(balancePaise, invoice.totals.grandTotalPaise),
      updatedAt: now,
    });

    recordAuditInTransaction(tx, args.businessId, {
      actorUid: args.uid,
      actorKind: 'user',
      action: 'adjustment.settlement-deduction',
      subjectType: 'invoice',
      subjectId: invoice.id,
      detail: { amountPaise: args.amountPaise },
    });

    return adjustment;
  });
}

export async function listPayments(businessId: string, limit = 200): Promise<PaymentRecord[]> {
  const snap = await paymentsCol(businessId).orderBy('createdAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => d.data() as PaymentRecord);
}

export async function listPaymentsForInvoice(businessId: string, invoiceId: string): Promise<PaymentRecord[]> {
  const snap = await paymentsCol(businessId).orderBy('createdAt', 'desc').limit(500).get();
  return snap.docs
    .map((d) => d.data() as PaymentRecord)
    .filter((p) => p.allocations.some((a) => a.invoiceId === invoiceId));
}

/** Unapplied credit sitting with a customer, from overpayments. */
export async function customerUnappliedCredit(businessId: string, customerId: string): Promise<number> {
  const snap = await paymentsCol(businessId).where('customerId', '==', customerId).limit(500).get();
  return snap.docs.reduce((total, d) => total + ((d.data() as PaymentRecord).unappliedPaise ?? 0), 0);
}
