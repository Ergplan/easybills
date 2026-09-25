/**
 * The accountant pack.
 *
 * What an accountant actually needs is the WORKINGS and the source rows, in a
 * form they can open in a spreadsheet and check. So the pack is a set of plain
 * CSVs plus a human-readable summary -- not a proprietary blob, and not
 * something dressed up as a portal upload file.
 *
 * LABELLING IS PART OF THE DELIVERABLE. Each file states the period, the GSTIN,
 * when it was produced, and -- prominently -- that a prepared return is not a
 * filed return.
 */

import { formatMoneyPlain, formatPercentPlain, formatQuantityPlain } from '@/lib/money';
import { formatPeriodLong, type MonthPeriod } from '@/lib/dates';
import { stateName } from '@/lib/gst/state-codes';

import type { ReconciliationFindingRecord, SupplierBillRecord } from './types';
import { hsnRowLabel } from './workings';
import type { Gstr1Tables, Gstr3bWorkings, OutwardDocument } from './workings';

export interface ExportFile {
  filename: string;
  contentType: string;
  content: string;
}

function csv(rows: Array<Array<string | number>>): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = String(cell ?? '');
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\n');
}

const DISCLAIMER =
  'This pack was PREPARED by EasyBills. It is not a filed return. ' +
  'Nothing here has been submitted to the GST portal.';

export function buildAccountantPack(args: {
  gstin: string;
  period: MonthPeriod;
  businessName: string;
  outwardDocuments: readonly OutwardDocument[];
  supplierBills: readonly SupplierBillRecord[];
  findings: readonly ReconciliationFindingRecord[];
  gstr1: Gstr1Tables;
  gstr3b: Gstr3bWorkings;
  rulePackVersion: string;
  preparedAt: string;
  statusLabel: string;
}): ExportFile[] {
  const header = [
    ['EasyBills accountant pack'],
    ['Business', args.businessName],
    ['GSTIN', args.gstin],
    ['Period', formatPeriodLong(args.period)],
    ['Prepared at', args.preparedAt],
    ['Status', args.statusLabel],
    ['Rule pack version', args.rulePackVersion],
    ['NOTE', DISCLAIMER],
    [],
  ];

  const files: ExportFile[] = [];

  // --- outward supplies ---------------------------------------------------
  files.push({
    filename: `sales-${args.period}.csv`,
    contentType: 'text/csv',
    content: csv([
      ...header,
      ['Document number', 'Date', 'Type', 'Customer', 'Customer GSTIN', 'Place of supply', 'Rate %', 'Taxable', 'CGST', 'SGST/UTGST', 'IGST', 'Cess', 'Source'],
      ...args.outwardDocuments.map((d) => [
        d.documentNumber,
        d.documentDate,
        d.documentType,
        d.customerName,
        d.customerGstin ?? '',
        d.placeOfSupplyStateCode ? stateName(d.placeOfSupplyStateCode) : '',
        formatPercentPlain(d.taxRateBp),
        formatMoneyPlain(d.taxableValuePaise),
        formatMoneyPlain(d.cgstPaise),
        formatMoneyPlain(d.sgstPaise),
        formatMoneyPlain(d.igstPaise),
        formatMoneyPlain(d.cessPaise),
        d.source === 'app' ? 'Raised in EasyBills' : 'Imported',
      ]),
    ]),
  });

  // --- purchases and reviewed credit --------------------------------------
  files.push({
    filename: `purchases-${args.period}.csv`,
    contentType: 'text/csv',
    content: csv([
      ...header,
      ['Supplier', 'Supplier GSTIN', 'Document number', 'Date', 'Type', 'Taxable', 'CGST', 'SGST/UTGST', 'IGST', 'Cess', 'Credit decision', 'Eligible CGST', 'Eligible SGST', 'Eligible IGST', 'Eligible cess', 'Reverse charge', 'Note', 'Source'],
      ...args.supplierBills.map((b) => [
        b.supplierName,
        b.supplierGstin ?? '',
        b.documentNumber,
        b.documentDate,
        b.documentType,
        formatMoneyPlain(b.taxableValuePaise),
        formatMoneyPlain(b.cgstPaise),
        formatMoneyPlain(b.sgstPaise),
        formatMoneyPlain(b.igstPaise),
        formatMoneyPlain(b.cessPaise),
        b.itcEligibility,
        formatMoneyPlain(b.eligibleCgstPaise),
        formatMoneyPlain(b.eligibleSgstPaise),
        formatMoneyPlain(b.eligibleIgstPaise),
        formatMoneyPlain(b.eligibleCessPaise),
        b.reverseCharge ? 'yes' : 'no',
        b.eligibilityNote ?? '',
        b.source,
      ]),
    ]),
  });

  // --- reconciliation -----------------------------------------------------
  files.push({
    filename: `reconciliation-${args.period}.csv`,
    contentType: 'text/csv',
    content: csv([
      ...header,
      ['Finding', 'Severity', 'Supplier', 'Document number', 'In books', 'In statement', 'Difference', 'Resolved', 'Reason recorded', 'What it means'],
      ...args.findings.map((f) => [
        f.kind,
        f.severity,
        f.supplierName ?? '',
        f.documentNumber ?? '',
        f.bookAmountPaise !== null ? formatMoneyPlain(f.bookAmountPaise) : '',
        f.statementAmountPaise !== null ? formatMoneyPlain(f.statementAmountPaise) : '',
        f.differencePaise !== null ? formatMoneyPlain(f.differencePaise) : '',
        f.resolved ? 'yes' : 'no',
        f.reviewReason ?? '',
        f.message,
      ]),
    ]),
  });

  // --- GSTR-1 tables ------------------------------------------------------
  files.push({
    filename: `gstr1-tables-${args.period}.csv`,
    contentType: 'text/csv',
    content: csv([
      ...header,
      ['Table', 'Key', 'Document number', 'Date', 'Rate %', 'Taxable', 'CGST', 'SGST/UTGST', 'IGST', 'Cess'],
      ...args.gstr1.b2b.flatMap((b) =>
        b.documents.flatMap((d) =>
          d.lines.map((l) => [
            'B2B',
            b.customerGstin,
            d.documentNumber,
            d.documentDate,
            formatPercentPlain(l.taxRateBp),
            formatMoneyPlain(l.taxableValuePaise),
            formatMoneyPlain(l.cgstPaise),
            formatMoneyPlain(l.sgstPaise),
            formatMoneyPlain(l.igstPaise),
            formatMoneyPlain(l.cessPaise),
          ]),
        ),
      ),
      ...args.gstr1.b2cSummary.map((s) => [
        'B2C (summary)',
        s.placeOfSupplyStateCode ? stateName(s.placeOfSupplyStateCode) : '',
        '',
        '',
        formatPercentPlain(s.taxRateBp),
        formatMoneyPlain(s.taxableValuePaise),
        formatMoneyPlain(s.cgstPaise),
        formatMoneyPlain(s.sgstPaise),
        formatMoneyPlain(s.igstPaise),
        formatMoneyPlain(s.cessPaise),
      ]),
      ...args.gstr1.creditDebitNotes.map((n) => [
        n.documentType === 'credit-note' ? 'Credit note' : 'Debit note',
        n.customerGstin ?? '',
        n.documentNumber,
        n.documentDate,
        '',
        formatMoneyPlain(n.taxableValuePaise),
        formatMoneyPlain(n.cgstPaise),
        formatMoneyPlain(n.sgstPaise),
        formatMoneyPlain(n.igstPaise),
        formatMoneyPlain(n.cessPaise),
      ]),
      [],
      ['HSN summary'],
      ['HSN/SAC', 'Description', 'Unit', 'Quantity', 'Rate %', 'Taxable', 'CGST', 'SGST/UTGST', 'IGST', 'Cess'],
      ...args.gstr1.hsnSummary.map((h) => [
        h.hsnCode ?? '',
        hsnRowLabel(h),
        h.unit ?? '',
        formatQuantityPlain(h.quantityMilli),
        formatPercentPlain(h.taxRateBp),
        formatMoneyPlain(h.taxableValuePaise),
        formatMoneyPlain(h.cgstPaise),
        formatMoneyPlain(h.sgstPaise),
        formatMoneyPlain(h.igstPaise),
        formatMoneyPlain(h.cessPaise),
      ]),
    ]),
  });

  // --- GSTR-3B workings ---------------------------------------------------
  const w = args.gstr3b;
  files.push({
    filename: `gstr3b-workings-${args.period}.csv`,
    contentType: 'text/csv',
    content: csv([
      ...header,
      ['Line', 'CGST', 'SGST/UTGST', 'IGST', 'Cess'],
      ['Outward tax (liability)', formatMoneyPlain(w.outward.cgstPaise), formatMoneyPlain(w.outward.sgstPaise), formatMoneyPlain(w.outward.igstPaise), formatMoneyPlain(w.outward.cessPaise)],
      ['Credit reviewed as eligible', formatMoneyPlain(w.eligibleItc.cgstPaise), formatMoneyPlain(w.eligibleItc.sgstPaise), formatMoneyPlain(w.eligibleItc.igstPaise), formatMoneyPlain(w.eligibleItc.cessPaise)],
      ['Less reversals', formatMoneyPlain(w.reversals.cgstPaise), formatMoneyPlain(w.reversals.sgstPaise), formatMoneyPlain(w.reversals.igstPaise), formatMoneyPlain(w.reversals.cessPaise)],
      ['Net credit for the period', formatMoneyPlain(w.netItc.cgstPaise), formatMoneyPlain(w.netItc.sgstPaise), formatMoneyPlain(w.netItc.igstPaise), formatMoneyPlain(w.netItc.cessPaise)],
      ['Opening credit balance', formatMoneyPlain(w.openingCredit.cgstPaise), formatMoneyPlain(w.openingCredit.sgstPaise), formatMoneyPlain(w.openingCredit.igstPaise), formatMoneyPlain(w.openingCredit.cessPaise)],
      ['To pay in cash', formatMoneyPlain(w.payableInCash.cgstPaise), formatMoneyPlain(w.payableInCash.sgstPaise), formatMoneyPlain(w.payableInCash.igstPaise), formatMoneyPlain(w.payableInCash.cessPaise)],
      ['Credit carried forward', formatMoneyPlain(w.closingCredit.cgstPaise), formatMoneyPlain(w.closingCredit.sgstPaise), formatMoneyPlain(w.closingCredit.igstPaise), formatMoneyPlain(w.closingCredit.cessPaise)],
      [],
      ['Total to pay in cash', formatMoneyPlain(w.payableInCash.totalPaise)],
      ['Cash figure is provisional', w.cashFigureIsProvisional ? 'YES - ledger balances not available from the portal' : 'no'],
      [],
      ['Notes'],
      ...w.notes.map((n) => [n]),
    ]),
  });

  // --- human-readable summary --------------------------------------------
  files.push({
    filename: `README-${args.period}.txt`,
    contentType: 'text/plain',
    content: [
      `EasyBills GST pack — ${args.businessName}`,
      `GSTIN ${args.gstin} · ${formatPeriodLong(args.period)}`,
      `Prepared ${args.preparedAt}`,
      `Status: ${args.statusLabel}`,
      '',
      DISCLAIMER,
      '',
      'WHAT THESE WORDS MEAN',
      '  Prepared — the figures have been worked out from the records in the app.',
      '  Reviewed — a person has checked the findings and the credit decisions.',
      '  Ready    — nothing is blocking; it can be taken to the portal.',
      '  Uploaded — a file has been sent, and the portal is processing it.',
      '  Filed    — the portal confirmed it and issued an acknowledgement number.',
      '             ONLY this means the return is filed. A generated file, an',
      '             upload receipt, a challan or a payment receipt does not.',
      '',
      'FILES',
      '  sales-*.csv           every outward document, with its source',
      '  purchases-*.csv       every supplier bill and the credit decision recorded for it',
      '  reconciliation-*.csv  where the books and the portal statement disagree',
      '  gstr1-tables-*.csv    the outward tables, with an HSN summary',
      '  gstr3b-workings-*.csv the liability, credit and cash working',
      '',
      'IMPORTANT',
      '  Credit is included only where a person recorded a decision on that bill.',
      '  Nothing is claimed automatically because it appeared in GSTR-2B.',
      w.cashFigureIsProvisional
        ? '  The cash figure is PROVISIONAL: ledger balances were not available.'
        : '  Ledger balances were taken from an imported portal statement.',
      '',
      `Rule pack: ${args.rulePackVersion}`,
    ].join('\n'),
  });

  return files;
}
