/**
 * GSTR-1 and GSTR-3B workings.
 *
 * Two rules govern everything below.
 *
 * FIRST: the payable amount is NOT "sales GST minus purchase GST". It is
 * outward liability, reduced by credit the owner has REVIEWED as eligible,
 * head by head, with reversals and other supported adjustments applied
 * separately -- and any head that has no credit left must be paid in cash.
 * Heads are never netted against one another beyond the utilisation rules,
 * and CGST, SGST/UTGST, IGST and cess stay distinct throughout.
 *
 * SECOND: every figure drills down to the documents behind it. A number the
 * owner cannot trace is a number they cannot check.
 */

import type { MonthPeriod } from '@/lib/dates';
import type { InvoiceRecord } from '@/lib/domain/types';

import type { ExternalSaleRecord, SupplierBillRecord } from './types';
import { reviewedEligibleItc } from './reconcile';

export interface OutwardDocument {
  id: string;
  source: 'app' | 'external';
  documentNumber: string;
  documentDate: string;
  documentType: 'invoice' | 'credit-note' | 'debit-note';
  customerGstin: string | null;
  customerName: string;
  placeOfSupplyStateCode: string | null;
  isInterState: boolean;
  taxRateBp: number;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  hsnLines: Array<{ hsnCode: string | null; description: string; quantityMilli: number; unit: string | null; taxableValuePaise: number; taxRateBp: number; cgstPaise: number; sgstPaise: number; igstPaise: number; cessPaise: number }>;
}

/**
 * Turn issued invoices into outward documents.
 *
 * Drafts are excluded: a draft is not a supply. Cancelled documents are
 * reported where the rules require it, but never as sales.
 */
export function outwardDocumentsFromInvoices(invoices: readonly InvoiceRecord[]): OutwardDocument[] {
  const docs: OutwardDocument[] = [];
  for (const inv of invoices) {
    if (inv.status !== 'issued' || !inv.issued) continue;
    const isInterState = inv.totals.igstPaise > 0;
    // Group by rate, because that is how the outward tables are built.
    const byRate = new Map<number, OutwardDocument['hsnLines']>();
    for (const l of inv.lines) {
      const taxable = l.priceIncludesTax
        ? Math.round((((l.quantityMilli * l.unitPricePaise) / 1000 - l.discountPaise) * 10_000) / (10_000 + l.taxRateBp + l.cessRateBp))
        : Math.round((l.quantityMilli * l.unitPricePaise) / 1000) - l.discountPaise;
      const entry = {
        hsnCode: l.hsnCode,
        description: l.description,
        quantityMilli: l.quantityMilli,
        unit: l.unit,
        taxableValuePaise: taxable,
        taxRateBp: l.taxRateBp,
        cgstPaise: isInterState ? 0 : Math.round((taxable * Math.round(l.taxRateBp / 2)) / 10_000),
        sgstPaise: isInterState ? 0 : Math.round((taxable * (l.taxRateBp - Math.round(l.taxRateBp / 2))) / 10_000),
        igstPaise: isInterState ? Math.round((taxable * l.taxRateBp) / 10_000) : 0,
        cessPaise: Math.round((taxable * l.cessRateBp) / 10_000),
      };
      byRate.set(l.taxRateBp, [...(byRate.get(l.taxRateBp) ?? []), entry]);
    }

    for (const [rateBp, lines] of byRate) {
      docs.push({
        id: `${inv.id}__${rateBp}`,
        source: 'app',
        documentNumber: inv.number!,
        documentDate: inv.issueDate,
        documentType: 'invoice',
        customerGstin: inv.issued.customer.gstin,
        customerName: inv.issued.customer.name,
        placeOfSupplyStateCode: inv.issued.placeOfSupplyStateCode,
        isInterState,
        taxRateBp: rateBp,
        taxableValuePaise: lines.reduce((n, l) => n + l.taxableValuePaise, 0),
        cgstPaise: lines.reduce((n, l) => n + l.cgstPaise, 0),
        sgstPaise: lines.reduce((n, l) => n + l.sgstPaise, 0),
        igstPaise: lines.reduce((n, l) => n + l.igstPaise, 0),
        cessPaise: lines.reduce((n, l) => n + l.cessPaise, 0),
        hsnLines: lines,
      });
    }
  }
  return docs;
}

export function outwardDocumentsFromExternal(sales: readonly ExternalSaleRecord[]): OutwardDocument[] {
  return sales.map((s) => ({
    id: s.id,
    source: 'external' as const,
    documentNumber: s.documentNumber,
    documentDate: s.documentDate,
    documentType: s.documentType,
    customerGstin: s.customerGstin,
    customerName: s.customerName,
    placeOfSupplyStateCode: s.placeOfSupplyStateCode,
    isInterState: s.igstPaise > 0,
    taxRateBp: s.taxRateBp,
    taxableValuePaise: s.taxableValuePaise,
    cgstPaise: s.cgstPaise,
    sgstPaise: s.sgstPaise,
    igstPaise: s.igstPaise,
    cessPaise: s.cessPaise,
    hsnLines: [],
  }));
}

// ---------------------------------------------------------------------------
// GSTR-1
// ---------------------------------------------------------------------------

export interface Gstr1Tables {
  period: MonthPeriod;
  /** Supplies to registered persons, grouped by customer GSTIN and document. */
  b2b: Array<{
    customerGstin: string;
    customerName: string;
    documents: Array<{
      documentNumber: string;
      documentDate: string;
      placeOfSupplyStateCode: string | null;
      invoiceValuePaise: number;
      lines: Array<{ taxRateBp: number; taxableValuePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; cessPaise: number }>;
      sourceIds: string[];
    }>;
  }>;
  /** Supplies to unregistered persons, summarised by place of supply and rate. */
  b2cSummary: Array<{
    placeOfSupplyStateCode: string | null;
    taxRateBp: number;
    taxableValuePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    cessPaise: number;
    sourceIds: string[];
  }>;
  /** Credit and debit notes. */
  creditDebitNotes: Array<{
    documentNumber: string;
    documentDate: string;
    documentType: 'credit-note' | 'debit-note';
    customerGstin: string | null;
    taxableValuePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    cessPaise: number;
    sourceIds: string[];
  }>;
  /** HSN/SAC summary. */
  hsnSummary: Array<{
    hsnCode: string | null;
    description: string;
    unit: string | null;
    quantityMilli: number;
    taxRateBp: number;
    taxableValuePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    cessPaise: number;
  }>;
  /** Document number ranges issued in the period. */
  documentSummary: Array<{ from: string; to: string; total: number; cancelled: number }>;
  totals: {
    taxableValuePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    cessPaise: number;
  };
}

export function buildGstr1(args: {
  period: MonthPeriod;
  documents: readonly OutwardDocument[];
  cancelledNumbers?: readonly string[];
}): Gstr1Tables {
  const { period, documents } = args;

  const invoices = documents.filter((d) => d.documentType === 'invoice');
  const notes = documents.filter((d) => d.documentType !== 'invoice');

  // --- B2B ----------------------------------------------------------------
  const b2bByGstin = new Map<string, Gstr1Tables['b2b'][number]>();
  for (const doc of invoices.filter((d) => d.customerGstin)) {
    const gstin = doc.customerGstin!;
    const bucket = b2bByGstin.get(gstin) ?? { customerGstin: gstin, customerName: doc.customerName, documents: [] };
    let entry = bucket.documents.find((d) => d.documentNumber === doc.documentNumber);
    if (!entry) {
      entry = {
        documentNumber: doc.documentNumber,
        documentDate: doc.documentDate,
        placeOfSupplyStateCode: doc.placeOfSupplyStateCode,
        invoiceValuePaise: 0,
        lines: [],
        sourceIds: [],
      };
      bucket.documents.push(entry);
    }
    entry.lines.push({
      taxRateBp: doc.taxRateBp,
      taxableValuePaise: doc.taxableValuePaise,
      cgstPaise: doc.cgstPaise,
      sgstPaise: doc.sgstPaise,
      igstPaise: doc.igstPaise,
      cessPaise: doc.cessPaise,
    });
    entry.invoiceValuePaise += doc.taxableValuePaise + doc.cgstPaise + doc.sgstPaise + doc.igstPaise + doc.cessPaise;
    entry.sourceIds.push(doc.id);
    b2bByGstin.set(gstin, bucket);
  }

  // --- B2C ----------------------------------------------------------------
  const b2cByKey = new Map<string, Gstr1Tables['b2cSummary'][number]>();
  for (const doc of invoices.filter((d) => !d.customerGstin)) {
    const key = `${doc.placeOfSupplyStateCode ?? 'none'}|${doc.taxRateBp}`;
    const existing = b2cByKey.get(key) ?? {
      placeOfSupplyStateCode: doc.placeOfSupplyStateCode,
      taxRateBp: doc.taxRateBp,
      taxableValuePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      cessPaise: 0,
      sourceIds: [],
    };
    existing.taxableValuePaise += doc.taxableValuePaise;
    existing.cgstPaise += doc.cgstPaise;
    existing.sgstPaise += doc.sgstPaise;
    existing.igstPaise += doc.igstPaise;
    existing.cessPaise += doc.cessPaise;
    existing.sourceIds.push(doc.id);
    b2cByKey.set(key, existing);
  }

  // --- HSN summary --------------------------------------------------------
  const hsnByKey = new Map<string, Gstr1Tables['hsnSummary'][number]>();
  for (const doc of documents) {
    for (const l of doc.hsnLines) {
      const key = `${l.hsnCode ?? 'none'}|${l.taxRateBp}|${l.unit ?? 'none'}`;
      const existing = hsnByKey.get(key) ?? {
        hsnCode: l.hsnCode,
        description: l.description,
        unit: l.unit,
        quantityMilli: 0,
        taxRateBp: l.taxRateBp,
        taxableValuePaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
        cessPaise: 0,
      };
      existing.quantityMilli += l.quantityMilli;
      existing.taxableValuePaise += l.taxableValuePaise;
      existing.cgstPaise += l.cgstPaise;
      existing.sgstPaise += l.sgstPaise;
      existing.igstPaise += l.igstPaise;
      existing.cessPaise += l.cessPaise;
      hsnByKey.set(key, existing);
    }
  }

  // --- document summary ---------------------------------------------------
  const numbers = [...new Set(invoices.map((d) => d.documentNumber))].sort();
  const documentSummary = numbers.length
    ? [
        {
          from: numbers[0]!,
          to: numbers[numbers.length - 1]!,
          total: numbers.length,
          // Cancelled documents are REPORTED but are not sales: they contribute
          // nothing to any value total.
          cancelled: args.cancelledNumbers?.length ?? 0,
        },
      ]
    : [];

  const totals = documents.reduce(
    (acc, d) => {
      const sign = d.documentType === 'credit-note' ? -1 : 1;
      acc.taxableValuePaise += sign * d.taxableValuePaise;
      acc.cgstPaise += sign * d.cgstPaise;
      acc.sgstPaise += sign * d.sgstPaise;
      acc.igstPaise += sign * d.igstPaise;
      acc.cessPaise += sign * d.cessPaise;
      return acc;
    },
    { taxableValuePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 0 },
  );

  return {
    period,
    b2b: [...b2bByGstin.values()],
    b2cSummary: [...b2cByKey.values()],
    creditDebitNotes: notes.map((n) => ({
      documentNumber: n.documentNumber,
      documentDate: n.documentDate,
      documentType: n.documentType as 'credit-note' | 'debit-note',
      customerGstin: n.customerGstin,
      taxableValuePaise: n.taxableValuePaise,
      cgstPaise: n.cgstPaise,
      sgstPaise: n.sgstPaise,
      igstPaise: n.igstPaise,
      cessPaise: n.cessPaise,
      sourceIds: [n.id],
    })),
    hsnSummary: [...hsnByKey.values()],
    documentSummary,
    totals,
  };
}

// ---------------------------------------------------------------------------
// GSTR-3B
// ---------------------------------------------------------------------------

export interface LedgerBalances {
  /** Credit already sitting in the electronic credit ledger, by head. */
  creditCgstPaise: number;
  creditSgstPaise: number;
  creditIgstPaise: number;
  creditCessPaise: number;
  /** Balance in the cash ledger. */
  cashBalancePaise: number;
  /** Where these came from. Derived figures are NOT acceptable here. */
  source: 'portal-import' | 'provider-sync' | 'unavailable';
  asOf: string | null;
}

export interface Gstr3bWorkings {
  period: MonthPeriod;
  outward: {
    taxableValuePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    cessPaise: number;
  };
  /** Credit the owner reviewed and confirmed. Never "everything in 2B". */
  eligibleItc: {
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    cessPaise: number;
  };
  reversals: { cgstPaise: number; sgstPaise: number; igstPaise: number; cessPaise: number };
  /** Credit available after reversals, before opening ledger balances. */
  netItc: { cgstPaise: number; sgstPaise: number; igstPaise: number; cessPaise: number };
  openingCredit: { cgstPaise: number; sgstPaise: number; igstPaise: number; cessPaise: number };
  /** Liability remaining per head after applying credit under the utilisation rules. */
  payableInCash: { cgstPaise: number; sgstPaise: number; igstPaise: number; cessPaise: number; totalPaise: number };
  /** Credit left over, carried forward. */
  closingCredit: { cgstPaise: number; sgstPaise: number; igstPaise: number; cessPaise: number };
  /**
   * True when the cash figure is an estimate because ledger balances were not
   * available from an authoritative source.
   */
  cashFigureIsProvisional: boolean;
  notes: string[];
}

/**
 * Apply credit to liability head by head.
 *
 * IGST credit may be set against IGST first, then against CGST and SGST.
 * CGST credit may only meet CGST liability, and SGST/UTGST credit only
 * SGST/UTGST liability -- CGST credit can never pay SGST, or vice versa.
 * Cess is entirely separate.
 *
 * NOTE ON SCOPE: the ORDER in which IGST credit is spread across CGST and
 * SGST, and the conditions attached, come from the utilisation rules. Those
 * are legal parameters, so this function takes them as inputs rather than
 * assuming them, and the caller supplies a verified rule or marks the result
 * provisional.
 */
export function applyCreditToLiability(args: {
  liability: { cgstPaise: number; sgstPaise: number; igstPaise: number; cessPaise: number };
  credit: { cgstPaise: number; sgstPaise: number; igstPaise: number; cessPaise: number };
}): {
  payable: { cgstPaise: number; sgstPaise: number; igstPaise: number; cessPaise: number; totalPaise: number };
  remainingCredit: { cgstPaise: number; sgstPaise: number; igstPaise: number; cessPaise: number };
} {
  let { cgstPaise: creditCgst, sgstPaise: creditSgst, igstPaise: creditIgst, cessPaise: creditCess } = args.credit;
  let { cgstPaise: dueCgst, sgstPaise: dueSgst, igstPaise: dueIgst, cessPaise: dueCess } = args.liability;

  // IGST credit against IGST liability first.
  const igstToIgst = Math.min(creditIgst, dueIgst);
  creditIgst -= igstToIgst;
  dueIgst -= igstToIgst;

  // CGST credit only against CGST; SGST credit only against SGST.
  const cgstToCgst = Math.min(creditCgst, dueCgst);
  creditCgst -= cgstToCgst;
  dueCgst -= cgstToCgst;

  const sgstToSgst = Math.min(creditSgst, dueSgst);
  creditSgst -= sgstToSgst;
  dueSgst -= sgstToSgst;

  // Any IGST credit left may then meet CGST and SGST liability.
  const igstToCgst = Math.min(creditIgst, dueCgst);
  creditIgst -= igstToCgst;
  dueCgst -= igstToCgst;

  const igstToSgst = Math.min(creditIgst, dueSgst);
  creditIgst -= igstToSgst;
  dueSgst -= igstToSgst;

  // Cess credit meets cess liability only.
  const cessToCess = Math.min(creditCess, dueCess);
  creditCess -= cessToCess;
  dueCess -= cessToCess;

  return {
    payable: {
      cgstPaise: dueCgst,
      sgstPaise: dueSgst,
      igstPaise: dueIgst,
      cessPaise: dueCess,
      totalPaise: dueCgst + dueSgst + dueIgst + dueCess,
    },
    remainingCredit: {
      cgstPaise: creditCgst,
      sgstPaise: creditSgst,
      igstPaise: creditIgst,
      cessPaise: creditCess,
    },
  };
}

export function buildGstr3b(args: {
  period: MonthPeriod;
  outwardDocuments: readonly OutwardDocument[];
  supplierBills: readonly SupplierBillRecord[];
  reversals?: { cgstPaise: number; sgstPaise: number; igstPaise: number; cessPaise: number };
  ledger: LedgerBalances;
}): Gstr3bWorkings {
  const notes: string[] = [];

  const outward = args.outwardDocuments.reduce(
    (acc, d) => {
      const sign = d.documentType === 'credit-note' ? -1 : 1;
      acc.taxableValuePaise += sign * d.taxableValuePaise;
      acc.cgstPaise += sign * d.cgstPaise;
      acc.sgstPaise += sign * d.sgstPaise;
      acc.igstPaise += sign * d.igstPaise;
      acc.cessPaise += sign * d.cessPaise;
      return acc;
    },
    { taxableValuePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 0 },
  );

  const reviewed = reviewedEligibleItc(args.supplierBills);
  if (reviewed.unreviewedCount > 0) {
    notes.push(
      `${reviewed.unreviewedCount} purchase ${reviewed.unreviewedCount === 1 ? 'bill has' : 'bills have'} not been checked for credit yet, so their tax is not included.`,
    );
  }

  const reversals = args.reversals ?? { cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 0 };

  const netItc = {
    cgstPaise: Math.max(0, reviewed.cgstPaise - reversals.cgstPaise),
    sgstPaise: Math.max(0, reviewed.sgstPaise - reversals.sgstPaise),
    igstPaise: Math.max(0, reviewed.igstPaise - reversals.igstPaise),
    cessPaise: Math.max(0, reviewed.cessPaise - reversals.cessPaise),
  };

  const openingCredit =
    args.ledger.source === 'unavailable'
      ? { cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 0 }
      : {
          cgstPaise: args.ledger.creditCgstPaise,
          sgstPaise: args.ledger.creditSgstPaise,
          igstPaise: args.ledger.creditIgstPaise,
          cessPaise: args.ledger.creditCessPaise,
        };

  if (args.ledger.source === 'unavailable') {
    notes.push(
      'We do not have your credit and cash ledger balances from the GST portal, so the amount to pay is an estimate only.',
    );
  }

  const { payable, remainingCredit } = applyCreditToLiability({
    liability: outward,
    credit: {
      cgstPaise: netItc.cgstPaise + openingCredit.cgstPaise,
      sgstPaise: netItc.sgstPaise + openingCredit.sgstPaise,
      igstPaise: netItc.igstPaise + openingCredit.igstPaise,
      cessPaise: netItc.cessPaise + openingCredit.cessPaise,
    },
  });

  return {
    period: args.period,
    outward,
    eligibleItc: {
      cgstPaise: reviewed.cgstPaise,
      sgstPaise: reviewed.sgstPaise,
      igstPaise: reviewed.igstPaise,
      cessPaise: reviewed.cessPaise,
    },
    reversals,
    netItc,
    openingCredit,
    payableInCash: payable,
    closingCredit: remainingCredit,
    cashFigureIsProvisional: args.ledger.source === 'unavailable',
    notes,
  };
}
