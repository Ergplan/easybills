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
import { deleteDoc, getDoc, patchDoc, putDoc, queryDocs } from '@/server/db/docs';
import { pool, withTx, type Db } from '@/server/db/pool';
import { recordAudit, recordAuditInTransaction } from '@/server/services/audit';
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
 * Fill in fields added after a record was written.
 *
 * A JSON read is a cast, so a record written by an earlier build arrives
 * missing whatever has been added since, while the type says otherwise. Filling
 * the gap in one place lets every caller trust the type rather than re-checking.
 */
function asInvoice(data: InvoiceRecord): InvoiceRecord {
  const rec = data as InvoiceRecord;
  return {
    ...rec,
    // A line saved before the rate question existed counts as answered: an
    // owner is not retrospectively accused of skipping a question we never
    // asked, and their issued bills keep the rates they were issued with.
    lines: rec.lines?.map((l) => ({ ...l, taxRateChosen: l.taxRateChosen ?? true })) ?? rec.lines,
    remindersSent: rec.remindersSent ?? 0,
    lastRemindedAt: rec.lastRemindedAt ?? null,
  };
}

/** The owner opened WhatsApp with a reminder. Counted, dated, and that is all we know. */
export async function noteReminder(businessId: string, invoiceId: string): Promise<void> {
  await pool().query(
    `update invoices set data = data || jsonb_build_object(
       'remindersSent', coalesce((data->>'remindersSent')::int, 0) + 1,
       'lastRemindedAt', $3::text)
     where business_id = $1 and id = $2`,
    [businessId, invoiceId, new Date().toISOString()],
  );
}

export async function getInvoice(businessId: string, invoiceId: string): Promise<InvoiceRecord | null> {
  const data = await getDoc<InvoiceRecord>(pool(), 'invoices', businessId, invoiceId);
  return data ? asInvoice(data) : null;
}

/** Merge fields into a bill's record. For links (contract, stage) set after the fact. */
export async function patchInvoice(businessId: string, invoiceId: string, patch: Partial<InvoiceRecord>): Promise<void> {
  await patchDoc(pool(), 'invoices', businessId, invoiceId, patch);
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
  const now = new Date().toISOString();

  return withTx(async (tx) => {
    const stored = await getDoc<InvoiceRecord>(tx, 'invoices', args.business.id, args.invoiceId, { lock: true });
    const existing = stored ? asInvoice(stored) : null;

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
      projectId: existing?.projectId ?? null,
      projectStage: existing?.projectStage ?? null,
      revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      createdByUid: existing?.createdByUid ?? args.uid,
    };

    await putDoc(tx, 'invoices', args.business.id, args.invoiceId, record);
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
 * Everything below happens in ONE Postgres transaction:
 *   1. re-read the draft and re-authorise it,
 *   2. re-price it from the stored lines (the client's totals are never trusted),
 *   3. re-run the legal assessment, refusing outright if it is blocked,
 *   4. allocate the next number for the financial year from a counter document,
 *   5. reserve the formatted number so a prefix change can never duplicate one,
 *   6. write the immutable snapshot of seller, customer, lines and tax terms.
 *
 * Double-click safety: if the draft is already issued when the transaction runs,
 * the existing invoice is returned unchanged. The draft row is locked first,
 * so a second concurrent call waits, then finds it issued.
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

  return withTx(async (tx) => {
    const stored = await getDoc<InvoiceRecord>(tx, 'invoices', businessId, args.invoiceId, { lock: true });
    if (!stored) throw new InvoiceStateError('This bill no longer exists.');
    const draft = asInvoice(stored);

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
    const bizRows = await tx.query<{ data: BusinessRecord }>('select data from businesses where id = $1 for update', [
      businessId,
    ]);
    if (!bizRows.rows[0]) throw new InvoiceStateError('Business not found.');
    const business: BusinessRecord = { ...bizRows.rows[0].data, id: businessId };

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

    const counterKey = counterId(fy, 'default');
    const nextSequence = (await readCounter(tx, businessId, counterKey, { lock: true })) ?? business.numbering.nextNumber;

    const number = formatNumber(business.numbering, fy, nextSequence);

    // The number itself is unique per year in the schema (invoices_number_once).
    // Checked here first so an owner whose prefix edit would repeat a number is
    // told why, rather than shown a database error.
    const taken = await tx.query(
      'select 1 from invoices where business_id = $1 and financial_year = $2 and number = $3',
      [businessId, fy, number],
    );
    if (taken.rowCount) {
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

    await putDoc(tx, 'invoices', businessId, draft.id, issuedInvoice);
    await writeCounter(tx, businessId, counterKey, nextSequence + 1);
    await tx.query(
      `update businesses set data = jsonb_set(data, '{numbering,nextNumber}', to_jsonb($2::int)) || jsonb_build_object('updatedAt', $3::text)
       where id = $1`,
      [businessId, nextSequence + 1, now],
    );

    await recordAuditInTransaction(tx, businessId, {
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
    // A redone contract bill is still that instalment of that contract.
    const link = { projectId: source.projectId ?? null, projectStage: source.projectStage ?? null };
    await patchDoc(pool(), 'invoices', args.business.id, draft.id, {
      duplicatedFromInvoiceId: source.id,
      scheduleId: null,
      occurrenceKey: null,
      ...link,
    });
    return { ...draft, duplicatedFromInvoiceId: source.id, ...link };
  });
}

export async function cancelDraft(businessId: string, invoiceId: string): Promise<void> {
  await withTx(async (tx) => {
    const inv = await getDoc<InvoiceRecord>(tx, 'invoices', businessId, invoiceId, { lock: true });
    if (!inv) return;
    if (inv.status !== 'draft') {
      throw new InvoiceStateError('An issued bill cannot be deleted. Use a credit note instead.');
    }
    await deleteDoc(tx, 'invoices', businessId, invoiceId);
  });
}

/**
 * Cancel an issued bill. Its number stays used -- the counter only moves
 * forward and the reservation stays -- so no later bill can carry it, and
 * the GST summary lists it as cancelled. Refused once money or a credit
 * note has been applied: that bill is a record of a settlement, and the
 * way to change it is a note, not a cancellation.
 */
export async function cancelIssuedInvoice(args: {
  businessId: string;
  uid: string;
  invoiceId: string;
  reason: string;
  redoneAsInvoiceId?: string | null;
}): Promise<InvoiceRecord> {
  const cancelled = await withTx(async (tx) => {
    const stored = await getDoc<InvoiceRecord>(tx, 'invoices', args.businessId, args.invoiceId, { lock: true });
    if (!stored) throw new InvoiceStateError('That bill no longer exists.');
    const inv = asInvoice(stored);
    if (inv.status === 'cancelled') return inv;
    if (inv.status !== 'issued') throw new InvoiceStateError('Only an issued bill can be cancelled.');
    if (inv.amountPaidPaise > 0 || inv.creditAppliedPaise > 0 || inv.debitAppliedPaise > 0 || inv.settlementDeductionPaise > 0) {
      throw new InvoiceStateError('Money has been recorded against this bill, so it cannot be cancelled.');
    }
    const now = new Date().toISOString();
    const patch = {
      status: 'cancelled' as const,
      cancelledAt: now,
      cancelledReason: args.reason.trim().slice(0, 300) || 'Cancelled',
      redoneAsInvoiceId: args.redoneAsInvoiceId ?? null,
      balancePaise: 0,
      paymentStatus: 'paid' as const,
      updatedAt: now,
      revision: inv.revision + 1,
    };
    await patchDoc(tx, 'invoices', args.businessId, args.invoiceId, patch);
    return { ...inv, ...patch };
  });
  await recordAudit(args.businessId, {
    actorUid: args.uid,
    actorKind: 'user',
    action: 'invoice.cancelled',
    subjectType: 'invoice',
    subjectId: args.invoiceId,
    detail: { number: cancelled.number, redoneAs: args.redoneAsInvoiceId ?? null },
  });
  return cancelled;
}

/**
 * Move the year's counter to the number the owner chose. The engine reads
 * the counter before the business record, so without this an edit under
 * Aap would show in the preview and never on a bill. Never backwards: the
 * reservation of every issued number stays, and the counter only grows.
 */
export async function setNextNumber(businessId: string, fy: FinancialYear, nextNumber: number): Promise<void> {
  await withTx(async (tx) => {
    const current = (await readCounter(tx, businessId, counterId(fy, 'default'), { lock: true })) ?? 1;
    if (nextNumber < current && current > 1) throw new InvoiceStateError(`The next number cannot go below ${current}.`);
    await writeCounter(tx, businessId, counterId(fy, 'default'), nextNumber);
  });
}

/** Number-series key, e.g. "default__2026-27". */
export const counterId = (financialYear: string, seriesId: string) => `${seriesId}__${financialYear}`;

/** The next number of a series, or null when the series has not started. */
export async function readCounter(db: Db, businessId: string, id: string, opts: { lock?: boolean } = {}): Promise<number | null> {
  const { rows } = await db.query<{ next_number: number }>(
    `select next_number from counters where business_id = $1 and id = $2${opts.lock ? ' for update' : ''}`,
    [businessId, id],
  );
  return rows[0]?.next_number ?? null;
}

export async function writeCounter(db: Db, businessId: string, id: string, nextNumber: number): Promise<void> {
  await db.query(
    `insert into counters (business_id, id, next_number) values ($1, $2, $3)
     on conflict (business_id, id) do update set next_number = excluded.next_number, updated_at = now()`,
    [businessId, id, nextNumber],
  );
}

export interface InvoiceListFilter {
  status?: 'draft' | 'issued' | 'cancelled';
  paymentStatus?: 'unpaid' | 'partly-paid' | 'paid';
  customerId?: string;
  limit?: number;
}

export async function listInvoices(businessId: string, filter: InvoiceListFilter = {}): Promise<InvoiceRecord[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length + 1}`));
  };
  if (filter.status) add('status = ?', filter.status);
  if (filter.paymentStatus) add('payment_status = ?', filter.paymentStatus);
  if (filter.customerId) add('customer_id = ?', filter.customerId);
  const rows = await queryDocs<InvoiceRecord>(pool(), 'invoices', businessId, {
    where: where.join(' and ') || undefined,
    params,
    order: 'updated_at desc',
    limit: filter.limit ?? 100,
  });
  return rows.map(asInvoice);
}

/**
 * The customer's most recent issued bill, for "Pichle jaisa hi?".
 */
export async function lastIssuedForCustomer(businessId: string, customerId: string): Promise<InvoiceRecord | null> {
  const rows = await queryDocs<InvoiceRecord>(pool(), 'invoices', businessId, {
    where: "customer_id = $2 and status = 'issued'",
    params: [customerId],
    order: 'issue_date desc, number_sequence desc nulls last',
    limit: 1,
  });
  return rows[0] ? asInvoice(rows[0]) : null;
}

/** Every issued bill, newest first. A business this app is for has a few hundred at most. */
export async function listIssued(businessId: string, limit = 1000): Promise<InvoiceRecord[]> {
  const rows = await queryDocs<InvoiceRecord>(pool(), 'invoices', businessId, {
    where: "status = 'issued'",
    order: 'issue_date desc, number_sequence desc nulls last',
    limit,
  });
  return rows.map(asInvoice);
}

/** Issued bills to one customer. */
export async function listIssuedForCustomer(businessId: string, customerId: string, limit = 500): Promise<InvoiceRecord[]> {
  const rows = await queryDocs<InvoiceRecord>(pool(), 'invoices', businessId, {
    where: "customer_id = $2 and status = 'issued'",
    params: [customerId],
    order: 'issue_date desc',
    limit,
  });
  return rows.map(asInvoice);
}

/** Every bill, newest bill date first, for the bills list. */
export async function listAllByIssueDate(businessId: string, limit = 300): Promise<InvoiceRecord[]> {
  const rows = await queryDocs<InvoiceRecord>(pool(), 'invoices', businessId, {
    order: 'issue_date desc, number_sequence desc nulls last',
    limit,
  });
  return rows.map(asInvoice);
}

/** Issued bills in a date range, for the quarter's hisaab. */
export async function listIssuedBetween(businessId: string, from: CivilDate, to: CivilDate): Promise<InvoiceRecord[]> {
  const rows = await queryDocs<InvoiceRecord>(pool(), 'invoices', businessId, {
    where: "status = 'issued' and issue_date >= $2 and issue_date <= $3",
    params: [from, to],
    order: 'issue_date asc, number_sequence asc nulls last',
    limit: 1000,
  });
  return rows.map(asInvoice);
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

