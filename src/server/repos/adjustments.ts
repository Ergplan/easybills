import 'server-only';

import { randomUUID } from 'node:crypto';

import { financialYearOf, todayIst, type CivilDate } from '@/lib/dates';
import type { AdjustmentRecord, BusinessRecord, InvoiceRecord } from '@/lib/domain/types';
import { getDoc, insertDoc, patchDoc, queryDocs } from '@/server/db/docs';
import { idempotentId } from '@/server/db/ids';
import { pool, withTx } from '@/server/db/pool';
import { readCounter, writeCounter } from '@/server/repos/invoices';
import { recordAuditInTransaction } from '@/server/services/audit';
import { computeBalance, paymentStatusFor } from '@/server/services/invoice-calc';

export class AdjustmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdjustmentError';
  }
}

/**
 * Credit and debit notes — the guided correction route for an issued bill.
 *
 * An issued invoice is immutable. When something was wrong, the correction is a
 * linked note, not an edit: the original stands, the note explains, and the
 * customer's balance moves.
 *
 * TWO THINGS KEPT SEPARATE, deliberately:
 *
 *  1. Correcting what the CUSTOMER OWES is not the same as changing what TAX is
 *     owed. `affectsTaxLiability` is a distinct, owner-confirmed field. A note
 *     raised simply to settle a dispute should not quietly reduce a tax return.
 *
 *  2. A note is not a payment. It never appears as money received.
 *
 * Notes get their own number sequence within the financial year, allocated in
 * the same transaction that writes them, so a number is never reused.
 */
export async function createAdjustment(args: {
  business: BusinessRecord;
  uid: string;
  invoiceId: string;
  kind: 'credit-note' | 'debit-note';
  amountPaise: number;
  reason: string;
  issueDate?: CivilDate;
  /** Whether the owner asserts this changes their GST liability. */
  affectsTaxLiability: boolean;
  /** Tax split, required when it does affect liability. */
  tax?: { taxableValuePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; cessPaise: number };
  /**
   * Fixed by the caller before the first attempt, so a double tap raises one
   * note rather than two. Two deliberate notes remain two notes: they arrive
   * with different keys.
   */
  idempotencyKey?: string;
}): Promise<AdjustmentRecord> {
  if (args.amountPaise <= 0) throw new AdjustmentError('Enter an amount greater than zero.');
  if (!args.reason.trim()) throw new AdjustmentError('Please say why this note is being raised.');

  const businessId = args.business.id;
  const issueDate = args.issueDate ?? todayIst();
  const fy = financialYearOf(issueDate);
  const adjId = args.idempotencyKey ? idempotentId('adj', args.idempotencyKey) : randomUUID();
  const prefix = args.kind === 'credit-note' ? 'CN-' : 'DN-';
  const counterKey = `${args.kind}__${fy}`;

  return withTx(async (tx) => {
    // Read first, so the losing side of a race returns the note the winner
    // raised instead of raising a second one against the same bill.
    const prior = await getDoc<AdjustmentRecord>(tx, 'adjustments', businessId, adjId);
    if (prior) return prior;

    const invoice = await getDoc<InvoiceRecord>(tx, 'invoices', businessId, args.invoiceId, { lock: true });
    if (!invoice) throw new AdjustmentError('That bill no longer exists.');

    if (invoice.status !== 'issued') {
      throw new AdjustmentError('A note can only be raised against a bill that has been issued.');
    }

    // A credit note cannot reduce the bill below what has already been settled.
    if (args.kind === 'credit-note') {
      const maxCredit = invoice.totals.grandTotalPaise - invoice.creditAppliedPaise;
      if (args.amountPaise > maxCredit) {
        throw new AdjustmentError(
          'This credit note is larger than the bill it corrects. Check the amount, or raise it against the right bill.',
        );
      }
    }

    const sequence = (await readCounter(tx, businessId, counterKey, { lock: true })) ?? 1;
    const number = `${prefix}${String(sequence).padStart(3, '0')}`;

    const now = new Date().toISOString();
    const tax = args.affectsTaxLiability
      ? args.tax ?? { taxableValuePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 0 }
      : { taxableValuePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 0 };

    const adjustment: AdjustmentRecord = {
      id: adjId,
      kind: args.kind,
      number,
      financialYear: fy,
      invoiceId: invoice.id,
      customerId: invoice.customer.customerId,
      issueDate,
      reason: args.reason.trim(),
      amountPaise: args.amountPaise,
      ...tax,
      affectsTaxLiability: args.affectsTaxLiability,
      status: 'issued',
      issuedAt: now,
      createdAt: now,
      createdByUid: args.uid,
    };
    await insertDoc(tx, 'adjustments', businessId, adjId, adjustment);

    const creditAppliedPaise =
      invoice.creditAppliedPaise + (args.kind === 'credit-note' ? args.amountPaise : 0);
    const debitAppliedPaise = invoice.debitAppliedPaise + (args.kind === 'debit-note' ? args.amountPaise : 0);

    const balancePaise = computeBalance({
      grandTotalPaise: invoice.totals.grandTotalPaise,
      amountPaidPaise: invoice.amountPaidPaise,
      creditAppliedPaise,
      debitAppliedPaise,
      settlementDeductionPaise: invoice.settlementDeductionPaise,
    });

    await patchDoc(tx, 'invoices', businessId, invoice.id, {
      creditAppliedPaise,
      debitAppliedPaise,
      balancePaise,
      paymentStatus: paymentStatusFor(balancePaise, invoice.totals.grandTotalPaise),
      updatedAt: now,
    });

    await writeCounter(tx, businessId, counterKey, sequence + 1);

    await recordAuditInTransaction(tx, businessId, {
      actorUid: args.uid,
      actorKind: 'user',
      action: `adjustment.${args.kind}`,
      subjectType: 'invoice',
      subjectId: invoice.id,
      detail: {
        number,
        amountPaise: args.amountPaise,
        affectsTaxLiability: args.affectsTaxLiability,
        reason: args.reason.trim().slice(0, 200),
      },
    });

    return adjustment;
  });
}

export async function listAdjustmentsForInvoice(
  businessId: string,
  invoiceId: string,
): Promise<AdjustmentRecord[]> {
  return queryDocs<AdjustmentRecord>(pool(), 'adjustments', businessId, {
    where: 'invoice_id = $2',
    params: [invoiceId],
    order: 'created_at asc',
    limit: 100,
  });
}

export async function listAdjustments(businessId: string, limit = 200): Promise<AdjustmentRecord[]> {
  return queryDocs<AdjustmentRecord>(pool(), 'adjustments', businessId, { order: 'created_at desc', limit });
}
