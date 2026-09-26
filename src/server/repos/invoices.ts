import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  financialYearOf,
  isWithinFinancialYear,
  todayIst,
  type CivilDate,
  type FinancialYear,
} from '@/lib/dates';
import type {
  BusinessRecord,
  InvoiceRecord,
  IssuedSnapshot,
  InvoiceLine,
  InvoiceParty,
} from '@/lib/domain/types';
import type { SupplyFlag } from '@/lib/gst/scenarios';
import { DEFAULT_RULE_PACK } from '@/lib/gst/ruleset';
import { db, FieldValue } from '@/server/firebase/admin';
import { businessDoc, countersCol, counterId, invoicesCol } from '@/server/firebase/paths';
import { recordAuditInTransaction } from '@/server/services/audit';
import { computeBalance, computeDueDate, paymentStatusFor, priceInvoice } from '@/server/services/invoice-calc';

export class DraftConflictError extends Error {
  constructor(public readonly currentRevision: number) {
    super('This bill was changed somewhere else. Refresh to see the latest version.');
    this.name = 'DraftConflictError';
  }
}

export class IssuanceBlockedError extends Error {
  constructor(public readonly blockers: Array<{ code: string; message: string; whatYouCanDo: string }>) {
    super(blockers[0]?.message ?? 'This bill cannot be issued yet.');
    this.name = 'IssuanceBlockedError';
  }
}

export class InvoiceStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceStateError';
  }
}

export function newInvoiceId(): string {
  return randomUUID();
}

export function emptyParty(name = 'Walk-in customer'): InvoiceParty {
  return {
    customerId: null,
    name,
    phone: null,
    email: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    pincode: null,
    stateCode: null,
    gstin: null,
    pan: null,
  };
}

/**
 * Fill in fields added after a document was written.
 *
 * A Firestore read is a cast, so a document written by an earlier build arrives
 * missing whatever has been added since, while the type says otherwise. Filling
 * the gap in one place lets every caller trust the type rather than re-checking.
 */
function asInvoice(data: FirebaseFirestore.DocumentData): InvoiceRecord {
  const rec = data as InvoiceRecord;
  return {
    ...rec,
    // A line saved before the rate question existed counts as answered: an
    // owner is not retrospectively accused of skipping a question we never
    // asked, and their issued bills keep the rates they were issued with.
    lines: rec.lines?.map((l) => ({ ...l, taxRateChosen: l.taxRateChosen ?? true })) ?? rec.lines,
  };
}

export async function getInvoice(businessId: string, invoiceId: string): Promise<InvoiceRecord | null> {
  const snap = await invoicesCol(businessId).doc(invoiceId).get();
  return snap.exists ? asInvoice(snap.data()!) : null;
}

/**
 * Create or update a draft.
 *
 * Revision protection: the client sends the revision it last saw. If the stored
 * revision has moved on -- another tab, another device, the recurrence worker --
 * we refuse rather than overwrite, and hand back the current revision so the UI
 * can say so honestly instead of silently losing the owner's typing.
 */
export async function saveDraft(args: {
  business: BusinessRecord;
  uid: string;
  invoiceId: string;
  kind: 'quick-bill' | 'customer-invoice';
  issueDate: CivilDate;
  dueDate?: CivilDate | null;
  paymentTermsDays?: number | null;
  billingPeriod?: { from: CivilDate; to: CivilDate } | null;
  customer: InvoiceParty;
  placeOfSupplyStateCode: string | null;
  supplyFlags: SupplyFlag[];
  lines: InvoiceLine[];
  notes: string | null;
  baseRevision: number;
}): Promise<InvoiceRecord> {
  const ref = invoicesCol(args.business.id).doc(args.invoiceId);
  const now = new Date().toISOString();

  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? asInvoice(snap.data()!) : null;

    if (existing && existing.status !== 'draft') {
      throw new InvoiceStateError('This bill has already been issued and cannot be edited.');
    }
    if (existing && existing.revision !== args.baseRevision) {
      throw new DraftConflictError(existing.revision);
    }

    const termsDays =
      args.paymentTermsDays === undefined ? args.business.defaultPaymentTermsDays : args.paymentTermsDays;
    const dueDate = args.dueDate !== undefined ? args.dueDate : computeDueDate(args.issueDate, termsDays);

    const { totals } = priceInvoice({
      business: args.business,
      lines: args.lines,
      placeOfSupplyStateCode: args.placeOfSupplyStateCode,
      supplyFlags: args.supplyFlags,
      issueDate: args.issueDate,
    });

    const record: InvoiceRecord = {
      id: args.invoiceId,
      kind: args.kind,
      status: 'draft',
      number: null,
      numberSequence: null,
      financialYear: null,
      issueDate: args.issueDate,
      dueDate,
      paymentTermsDays: termsDays,
      billingPeriod: args.billingPeriod ?? existing?.billingPeriod ?? null,
      customer: args.customer,
      placeOfSupplyStateCode: args.placeOfSupplyStateCode,
      supplyFlags: args.supplyFlags,
      lines: args.lines,
      notes: args.notes,
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
      scheduleId: existing?.scheduleId ?? null,
      occurrenceKey: existing?.occurrenceKey ?? null,
      duplicatedFromInvoiceId: existing?.duplicatedFromInvoiceId ?? null,
      revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      createdByUid: existing?.createdByUid ?? args.uid,
    };

    tx.set(ref, record);
    return record;
  });
}

function formatNumber(series: BusinessRecord['numbering'], fy: FinancialYear, sequence: number): string {
  const padded = String(sequence).padStart(series.padding, '0');
  const parts = [series.prefix, series.includeFinancialYear ? `${fy}/` : '', padded];
  return parts.join('');
}

/**
 * Issue an invoice.
 *
 * Everything below happens in ONE Firestore transaction:
 *   1. re-read the draft and re-authorise it,
 *   2. re-price it from the stored lines (the client's totals are never trusted),
 *   3. re-run the legal assessment, refusing outright if it is blocked,
 *   4. allocate the next number for the financial year from a counter document,
 *   5. reserve the formatted number so a prefix change can never duplicate one,
 *   6. write the immutable snapshot of seller, customer, lines and tax terms.
 *
 * Double-click safety: if the draft is already issued when the transaction runs,
 * the existing invoice is returned unchanged. Firestore retries the whole
 * transaction on contention, so two concurrent calls cannot both allocate.
 *
 * PDF rendering is deliberately OUTSIDE this transaction. A failed render must
 * never roll back an issued invoice -- the owner retries the render of the same
 * issued document, they do not issue a second one.
 */
export async function issueInvoice(args: {
  business: BusinessRecord;
  uid: string;
  invoiceId: string;
  /** Optional: the revision the owner reviewed, to catch an edit mid-review. */
  expectedRevision?: number;
}): Promise<{ invoice: InvoiceRecord; alreadyIssued: boolean }> {
  const businessId = args.business.id;
  const invoiceRef = invoicesCol(businessId).doc(args.invoiceId);

  return db().runTransaction(async (tx) => {
    const snap = await tx.get(invoiceRef);
    if (!snap.exists) throw new InvoiceStateError('This bill no longer exists.');
    const draft = asInvoice(snap.data()!);

    if (draft.status === 'issued') {
      // Idempotent: a second tap, a retry or a duplicated request returns the
      // invoice that was already issued instead of issuing another one.
      return { invoice: draft, alreadyIssued: true };
    }
    if (draft.status === 'cancelled') {
      throw new InvoiceStateError('This bill was cancelled and cannot be issued.');
    }
    if (args.expectedRevision !== undefined && draft.revision !== args.expectedRevision) {
      throw new DraftConflictError(draft.revision);
    }
    if (!draft.lines.length) {
      throw new InvoiceStateError('Add at least one item before issuing.');
    }

    // Re-read the business inside the transaction: the snapshot must reflect the
    // profile as it stands at issue time, not as it was when the page loaded.
    const bizSnap = await tx.get(businessDoc(businessId));
    if (!bizSnap.exists) throw new InvoiceStateError('Business not found.');
    const business = { id: bizSnap.id, ...(bizSnap.data() as Omit<BusinessRecord, 'id'>) };

    const { totals, computation, assessment } = priceInvoice({
      business,
      lines: draft.lines,
      placeOfSupplyStateCode: draft.placeOfSupplyStateCode,
      supplyFlags: draft.supplyFlags,
      issueDate: draft.issueDate,
    });

    if (!assessment.canIssue) {
      throw new IssuanceBlockedError(assessment.blockers);
    }
    if (assessment.documentKind === 'blocked') {
      throw new IssuanceBlockedError(assessment.blockers);
    }

    const fy = financialYearOf(draft.issueDate);
    if (!isWithinFinancialYear(draft.issueDate, business.activeFinancialYear)) {
      throw new IssuanceBlockedError([
        {
          code: 'outside-active-financial-year',
          message: `This bill is dated outside your current financial year (${business.activeFinancialYear}).`,
          whatYouCanDo: 'Change the bill date, or update the financial year in Business details.',
        },
      ]);
    }

    const seriesId = 'default';
    const counterRef = countersCol(businessId).doc(counterId(fy, seriesId));
    const counterSnap = await tx.get(counterRef);
    const nextSequence = counterSnap.exists
      ? (counterSnap.data()!.nextNumber as number)
      : business.numbering.nextNumber;

    const number = formatNumber(business.numbering, fy, nextSequence);

    // Reserve the formatted number itself. If the owner edits the prefix so that
    // a number would repeat, this create() fails and the whole issue aborts,
    // rather than producing two documents bearing the same number.
    const reservationRef = countersCol(businessId).doc(`issued__${fy}__${number}`);
    const reservationSnap = await tx.get(reservationRef);
    if (reservationSnap.exists) {
      throw new IssuanceBlockedError([
        {
          code: 'duplicate-number',
          message: `Bill number ${number} has already been used.`,
          whatYouCanDo: 'Change the starting number or prefix in Business details, then try again.',
        },
      ]);
    }

    const now = new Date().toISOString();
    const issued: IssuedSnapshot = {
      issuedAt: now,
      issuedByUid: args.uid,
      documentKind: assessment.documentKind === 'tax-invoice' ? 'tax-invoice' : 'invoice-no-gst',
      documentTitle: assessment.documentTitle,
      seller: {
        legalName: business.legalName,
        tradeName: business.tradeName,
        addressLine1: business.addressLine1,
        addressLine2: business.addressLine2,
        city: business.city,
        pincode: business.pincode,
        stateCode: business.stateCode,
        gstin: business.gstin,
        pan: business.pan,
        phone: business.phone,
        email: business.email,
        bank: business.bank,
        logoDataUrl: business.logoDataUrl,
        signatureDataUrl: business.signatureDataUrl,
        accentColour: business.accentColour,
      },
      customer: draft.customer,
      rulePackVersion: DEFAULT_RULE_PACK.version,
      supplyType: computation.supplyType,
      placeOfSupplyStateCode: draft.placeOfSupplyStateCode,
    };

    const balancePaise = computeBalance({
      grandTotalPaise: totals.grandTotalPaise,
      amountPaidPaise: 0,
      creditAppliedPaise: 0,
      debitAppliedPaise: 0,
      settlementDeductionPaise: 0,
    });

    const issuedInvoice: InvoiceRecord = {
      ...draft,
      status: 'issued',
      number,
      numberSequence: nextSequence,
      financialYear: fy,
      totals,
      issued,
      balancePaise,
      paymentStatus: paymentStatusFor(balancePaise, totals.grandTotalPaise),
      revision: draft.revision + 1,
      updatedAt: now,
    };

    tx.set(invoiceRef, issuedInvoice);
    tx.set(counterRef, {
      seriesId,
      financialYear: fy,
      nextNumber: nextSequence + 1,
      updatedAt: now,
    });
    tx.set(reservationRef, { number, invoiceId: draft.id, financialYear: fy, issuedAt: now });
    tx.update(businessDoc(businessId), { 'numbering.nextNumber': nextSequence + 1, updatedAt: now });

    recordAuditInTransaction(tx, businessId, {
      actorUid: args.uid,
      actorKind: 'user',
      action: 'invoice.issued',
      subjectType: 'invoice',
      subjectId: draft.id,
      detail: { number, grandTotalPaise: totals.grandTotalPaise, documentKind: issued.documentKind },
    });

    return { invoice: issuedInvoice, alreadyIssued: false };
  });
}

/**
 * Duplicate an invoice into a fresh draft.
 *
 * Deliberately NOT copied: number, issued snapshot, payment status, payments,
 * allocations, recurrence links. A duplicate is a new bill that happens to have
 * the same items -- it is not a copy of the original's history, and it must not
 * quietly attach itself to the original's monthly schedule.
 */
export async function duplicateInvoice(args: {
  business: BusinessRecord;
  uid: string;
  sourceInvoiceId: string;
  issueDate?: CivilDate;
}): Promise<InvoiceRecord> {
  const source = await getInvoice(args.business.id, args.sourceInvoiceId);
  if (!source) throw new InvoiceStateError('That bill no longer exists.');

  const issueDate = args.issueDate ?? todayIst();
  const termsDays = source.paymentTermsDays ?? args.business.defaultPaymentTermsDays;

  return saveDraft({
    business: args.business,
    uid: args.uid,
    invoiceId: newInvoiceId(),
    kind: source.kind,
    issueDate,
    dueDate: computeDueDate(issueDate, termsDays),
    paymentTermsDays: termsDays,
    // The billing period belongs to the original supply; a duplicate starts clean.
    billingPeriod: null,
    customer: source.customer,
    placeOfSupplyStateCode: source.placeOfSupplyStateCode,
    supplyFlags: source.supplyFlags,
    lines: source.lines.map((l) => ({ ...l, id: randomUUID() })),
    notes: source.notes,
    baseRevision: 0,
  }).then(async (draft) => {
    await invoicesCol(args.business.id)
      .doc(draft.id)
      .update({ duplicatedFromInvoiceId: source.id, scheduleId: null, occurrenceKey: null });
    return { ...draft, duplicatedFromInvoiceId: source.id };
  });
}

export async function cancelDraft(businessId: string, invoiceId: string): Promise<void> {
  const ref = invoicesCol(businessId).doc(invoiceId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const inv = asInvoice(snap.data()!);
    if (inv.status !== 'draft') {
      throw new InvoiceStateError('An issued bill cannot be deleted. Use a credit note instead.');
    }
    tx.delete(ref);
  });
}

export interface InvoiceListFilter {
  status?: 'draft' | 'issued' | 'cancelled';
  paymentStatus?: 'unpaid' | 'partly-paid' | 'paid';
  customerId?: string;
  limit?: number;
}

export async function listInvoices(businessId: string, filter: InvoiceListFilter = {}): Promise<InvoiceRecord[]> {
  let q: FirebaseFirestore.Query = invoicesCol(businessId);
  if (filter.status) q = q.where('status', '==', filter.status);
  if (filter.paymentStatus) q = q.where('paymentStatus', '==', filter.paymentStatus);
  if (filter.customerId) q = q.where('customer.customerId', '==', filter.customerId);
  q = q.orderBy('updatedAt', 'desc').limit(filter.limit ?? 100);
  const snap = await q.get();
  return snap.docs.map((d) => asInvoice(d.data()));
}

/**
 * The customer's most recent issued bill, for "Pichle jaisa hi?".
 *
 * No orderBy: the composite index that exists is (customer, status), and a
 * customer's bills are few enough to sort here.
 */
export async function lastIssuedForCustomer(businessId: string, customerId: string): Promise<InvoiceRecord | null> {
  const snap = await invoicesCol(businessId)
    .where('customer.customerId', '==', customerId)
    .where('status', '==', 'issued')
    .limit(100)
    .get();
  const bills = snap.docs.map((d) => asInvoice(d.data()));
  bills.sort((a, b) => (a.issueDate < b.issueDate ? 1 : a.issueDate > b.issueDate ? -1 : (b.numberSequence ?? 0) - (a.numberSequence ?? 0)));
  return bills[0] ?? null;
}

/** Recompute stored balance fields after a payment or adjustment changes. */
export function applyLedgerToInvoice(invoice: InvoiceRecord, ledger: {
  amountPaidPaise: number;
  creditAppliedPaise: number;
  debitAppliedPaise: number;
  settlementDeductionPaise: number;
}): InvoiceRecord {
  const balancePaise = computeBalance({
    grandTotalPaise: invoice.totals.grandTotalPaise,
    ...ledger,
  });
  return {
    ...invoice,
    ...ledger,
    balancePaise,
    paymentStatus: paymentStatusFor(balancePaise, invoice.totals.grandTotalPaise),
  };
}

export { FieldValue };
