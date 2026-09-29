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
import { getDoc, insertDoc, patchDoc, queryDocs } from '@/server/db/docs';
import { idempotentId } from '@/server/db/ids';
import { pool, withTx } from '@/server/db/pool';
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

  const paymentId = args.idempotencyKey ? idempotentId('pay', args.idempotencyKey) : randomUUID();
  const now = new Date().toISOString();

  return withTx(async (tx) => {
    // Read first, so the losing side of a race sees the winner's row rather
    // than writing its own. (If both read nothing, the second insert hits the
    // primary key, the transaction retries, and this read finds the winner.)
    const prior = await getDoc<PaymentRecord>(tx, 'payments', args.businessId, paymentId);
    if (prior) return prior;

    // Lock the bills in a fixed order, so two payments touching the same two
    // bills cannot each hold one and wait for the other.
    const locked = new Map<string, InvoiceRecord>();
    for (const id of [...new Set(args.allocations.map((a) => a.invoiceId))].sort()) {
      const inv = await getDoc<InvoiceRecord>(tx, 'invoices', args.businessId, id, { lock: true });
      if (inv) locked.set(id, inv);
    }

    let allocatedTotal = 0;
    const updates: Array<{ id: string; invoice: InvoiceRecord; add: number }> = [];

    for (let i = 0; i < args.allocations.length; i += 1) {
      const alloc = args.allocations[i]!;
      const invoice = locked.get(alloc.invoiceId);
      if (!invoice) throw new PaymentError('One of the bills no longer exists.');
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
      updates.push({ id: alloc.invoiceId, invoice, add: alloc.amountPaise });
    }

    if (allocatedTotal > args.amountPaise) {
      throw new PaymentError('You have applied more than the amount received.');
    }

    const unappliedPaise = args.amountPaise - allocatedTotal;

    const payment: PaymentRecord = {
      id: paymentId,
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
    await insertDoc(tx, 'payments', args.businessId, paymentId, payment);

    for (const u of updates) {
      const amountPaidPaise = u.invoice.amountPaidPaise + u.add;
      const balancePaise = computeBalance({
        grandTotalPaise: u.invoice.totals.grandTotalPaise,
        amountPaidPaise,
        creditAppliedPaise: u.invoice.creditAppliedPaise,
        debitAppliedPaise: u.invoice.debitAppliedPaise,
        settlementDeductionPaise: u.invoice.settlementDeductionPaise,
      });
      await patchDoc(tx, 'invoices', args.businessId, u.id, {
        amountPaidPaise,
        balancePaise,
        paymentStatus: paymentStatusFor(balancePaise, u.invoice.totals.grandTotalPaise),
        updatedAt: now,
      });
    }

    await recordAuditInTransaction(tx, args.businessId, {
      actorUid: args.uid,
      actorKind: 'user',
      action: 'payment.recorded',
      subjectType: 'payment',
      subjectId: paymentId,
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
  const reversalId = randomUUID();
  const now = new Date().toISOString();

  return withTx(async (tx) => {
    const original = await getDoc<PaymentRecord>(tx, 'payments', args.businessId, args.paymentId, { lock: true });
    if (!original) throw new PaymentError('That payment no longer exists.');
    if (original.reversedByPaymentId) throw new PaymentError('That payment has already been reversed.');
    if (original.reversalOfPaymentId) throw new PaymentError('A reversal cannot itself be reversed.');

    const locked = new Map<string, InvoiceRecord>();
    for (const id of [...new Set(original.allocations.map((a) => a.invoiceId))].sort()) {
      const inv = await getDoc<InvoiceRecord>(tx, 'invoices', args.businessId, id, { lock: true });
      if (inv) locked.set(id, inv);
    }

    const reversal: PaymentRecord = {
      id: reversalId,
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

    await insertDoc(tx, 'payments', args.businessId, reversalId, reversal);
    await patchDoc(tx, 'payments', args.businessId, original.id, { reversedByPaymentId: reversalId });

    for (const alloc of original.allocations) {
      const invoice = locked.get(alloc.invoiceId);
      if (!invoice) continue;
      const amountPaidPaise = invoice.amountPaidPaise - alloc.amountPaise;
      const balancePaise = computeBalance({
        grandTotalPaise: invoice.totals.grandTotalPaise,
        amountPaidPaise,
        creditAppliedPaise: invoice.creditAppliedPaise,
        debitAppliedPaise: invoice.debitAppliedPaise,
        settlementDeductionPaise: invoice.settlementDeductionPaise,
      });
      const updated = {
        ...invoice,
        amountPaidPaise,
        balancePaise,
        paymentStatus: paymentStatusFor(balancePaise, invoice.totals.grandTotalPaise),
        updatedAt: now,
      };
      locked.set(alloc.invoiceId, updated);
      await patchDoc(tx, 'invoices', args.businessId, alloc.invoiceId, {
        amountPaidPaise,
        balancePaise,
        paymentStatus: updated.paymentStatus,
        updatedAt: now,
      });
    }

    await recordAuditInTransaction(tx, args.businessId, {
      actorUid: args.uid,
      actorKind: 'user',
      action: 'payment.reversed',
      subjectType: 'payment',
      subjectId: original.id,
      detail: { reversalId, amountPaise: original.amountPaise },
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
  const adjId = args.idempotencyKey ? idempotentId('deduct', args.idempotencyKey) : randomUUID();
  const now = new Date().toISOString();

  return withTx(async (tx) => {
    const prior = await getDoc<AdjustmentRecord>(tx, 'adjustments', args.businessId, adjId);
    if (prior) return prior;

    const invoice = await getDoc<InvoiceRecord>(tx, 'invoices', args.businessId, args.invoiceId, { lock: true });
    if (!invoice) throw new PaymentError('That bill no longer exists.');
    if (invoice.status !== 'issued') throw new PaymentError('Only an issued bill can have a deduction recorded.');
    if (args.amountPaise > invoice.balancePaise) {
      throw new PaymentError('The deduction is more than the amount still outstanding on this bill.');
    }

    const adjustment: AdjustmentRecord = {
      id: adjId,
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
    await insertDoc(tx, 'adjustments', args.businessId, adjId, adjustment);

    const settlementDeductionPaise = invoice.settlementDeductionPaise + args.amountPaise;
    const balancePaise = computeBalance({
      grandTotalPaise: invoice.totals.grandTotalPaise,
      amountPaidPaise: invoice.amountPaidPaise,
      creditAppliedPaise: invoice.creditAppliedPaise,
      debitAppliedPaise: invoice.debitAppliedPaise,
      settlementDeductionPaise,
    });
    await patchDoc(tx, 'invoices', args.businessId, invoice.id, {
      settlementDeductionPaise,
      balancePaise,
      paymentStatus: paymentStatusFor(balancePaise, invoice.totals.grandTotalPaise),
      updatedAt: now,
    });

    await recordAuditInTransaction(tx, args.businessId, {
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
  return queryDocs<PaymentRecord>(pool(), 'payments', businessId, { order: 'created_at desc', limit });
}

export async function listPaymentsForInvoice(businessId: string, invoiceId: string): Promise<PaymentRecord[]> {
  return queryDocs<PaymentRecord>(pool(), 'payments', businessId, {
    where: "data->'allocations' @> $2::jsonb",
    params: [JSON.stringify([{ invoiceId }])],
    order: 'created_at desc',
    limit: 500,
  });
}

/** Unapplied credit sitting with a customer, from overpayments. */
export async function customerUnappliedCredit(businessId: string, customerId: string): Promise<number> {
  const { rows } = await pool().query<{ total: string | null }>(
    `select sum(coalesce((data->>'unappliedPaise')::bigint, 0)) as total from payments
     where business_id = $1 and customer_id = $2`,
    [businessId, customerId],
  );
  return Number(rows[0]?.total ?? 0);
}
