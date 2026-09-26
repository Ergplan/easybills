/**
 * GST ka hisaab: one quarter, the way a CA wants to see it.
 *
 * How many bills, how much sold, how much GST -- then the same split by rate,
 * and the company bills (customers with a GST number, which the CA reports
 * one by one) against the rest (reported as one B2C line). Built from the
 * issued bills' own snapshots; the totals row is the engine's stored figure,
 * and the per-rate rows are worked from the lines.
 */
import { formatMoneyIndian } from '@/lib/money';
import type { InvoiceRecord } from '@/lib/domain/types';
import { periodBounds, gstQuarterOf, type CivilDate, type MonthPeriod } from '@/lib/dates';

export interface RateRow {
  rateBp: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

export interface B2bRow {
  gstin: string;
  name: string;
  bills: number;
  totalPaise: number;
  taxPaise: number;
}

export interface QuarterSummary {
  label: string;
  from: CivilDate;
  to: CivilDate;
  bills: number;
  salesPaise: number;
  taxPaise: number;
  byRate: RateRow[];
  b2b: B2bRow[];
  b2cBills: number;
  b2cPaise: number;
}

export function quarterBounds(anyMonth: MonthPeriod): { label: string; from: CivilDate; to: CivilDate; months: MonthPeriod[] } {
  const q = gstQuarterOf(anyMonth);
  return {
    label: q.label,
    from: periodBounds(q.months[0]!).start,
    to: periodBounds(q.months[2]!).end,
    months: q.months,
  };
}

export function summariseQuarter(issued: readonly InvoiceRecord[], anyMonth: MonthPeriod): QuarterSummary {
  const { label, from, to } = quarterBounds(anyMonth);
  const bills = issued.filter((inv) => inv.status === 'issued' && inv.issueDate >= from && inv.issueDate <= to);

  const rates = new Map<number, RateRow>();
  const b2b = new Map<string, B2bRow>();
  let b2cBills = 0;
  let b2cPaise = 0;

  for (const inv of bills) {
    const intra = (inv.issued?.supplyType ?? (inv.totals.igstPaise > 0 ? 'inter-state' : 'intra-state')) === 'intra-state';
    for (const l of inv.lines) {
      const gross = Math.round((l.quantityMilli * l.unitPricePaise) / 1000) - l.discountPaise;
      const taxable = l.priceIncludesTax ? Math.round((gross * 10000) / (10000 + l.taxRateBp + l.cessRateBp)) : gross;
      const rateBp = inv.totals.totalTaxPaise > 0 ? l.taxRateBp : 0;
      const tax = Math.round((taxable * rateBp) / 10000);
      const row = rates.get(rateBp) ?? { rateBp, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
      row.taxablePaise += taxable;
      if (intra) {
        const half = Math.round(tax / 2);
        row.cgstPaise += half;
        row.sgstPaise += tax - half;
      } else {
        row.igstPaise += tax;
      }
      rates.set(rateBp, row);
    }

    const gstin = inv.issued?.customer.gstin ?? inv.customer.gstin;
    if (gstin) {
      const row = b2b.get(gstin) ?? { gstin, name: inv.customer.name, bills: 0, totalPaise: 0, taxPaise: 0 };
      row.bills += 1;
      row.totalPaise += inv.totals.grandTotalPaise;
      row.taxPaise += inv.totals.totalTaxPaise;
      b2b.set(gstin, row);
    } else {
      b2cBills += 1;
      b2cPaise += inv.totals.grandTotalPaise;
    }
  }

  return {
    label,
    from,
    to,
    bills: bills.length,
    salesPaise: bills.reduce((s, inv) => s + inv.totals.taxableValuePaise, 0),
    taxPaise: bills.reduce((s, inv) => s + inv.totals.totalTaxPaise, 0),
    byRate: [...rates.values()].sort((a, b) => b.rateBp - a.rateBp),
    b2b: [...b2b.values()].sort((a, b) => b.totalPaise - a.totalPaise),
    b2cBills,
    b2cPaise,
  };
}

/** The CSV the CA opens in Excel: one row per bill, then the rate table. */
export function quarterCsv(issued: readonly InvoiceRecord[], anyMonth: MonthPeriod, business: { name: string; gstin: string | null }): string {
  const q = summariseQuarter(issued, anyMonth);
  const bills = issued
    .filter((inv) => inv.status === 'issued' && inv.issueDate >= q.from && inv.issueDate <= q.to)
    .sort((a, b) => (a.issueDate < b.issueDate ? -1 : a.issueDate > b.issueDate ? 1 : (a.numberSequence ?? 0) - (b.numberSequence ?? 0)));
  const rows: Array<Array<string | number>> = [
    [`${business.name}`, business.gstin ? `GSTIN ${business.gstin}` : 'Not GST registered', `Sales ${q.label}`, `${q.from} to ${q.to}`],
    [],
    ['Bill no.', 'Date', 'Customer', 'Customer GSTIN', 'Place of supply', 'Taxable value', 'CGST', 'SGST/UTGST', 'IGST', 'Total'],
    ...bills.map((inv) => [
      inv.number ?? '',
      inv.issueDate,
      inv.customer.name,
      inv.issued?.customer.gstin ?? inv.customer.gstin ?? '',
      inv.issued?.placeOfSupplyStateCode ?? inv.placeOfSupplyStateCode ?? '',
      rupees(inv.totals.taxableValuePaise),
      rupees(inv.totals.cgstPaise),
      rupees(inv.totals.sgstPaise),
      rupees(inv.totals.igstPaise),
      rupees(inv.totals.grandTotalPaise),
    ]),
    [],
    ['Rate', 'Taxable value', 'CGST', 'SGST/UTGST', 'IGST'],
    ...q.byRate.map((r) => [`${r.rateBp / 100}%`, rupees(r.taxablePaise), rupees(r.cgstPaise), rupees(r.sgstPaise), rupees(r.igstPaise)]),
    [],
    ['Bills', q.bills],
    ['Taxable value', rupees(q.salesPaise)],
    ['GST', rupees(q.taxPaise)],
    ['B2B bills (customer has GSTIN)', q.b2b.reduce((s, r) => s + r.bills, 0)],
    ['B2C bills', q.b2cBills],
    [],
    ['Prepared by EkBill. This is a summary of bills issued, for your accountant. It is not a filed return.'],
  ];
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

function rupees(paise: number): string {
  return (paise / 100).toFixed(2);
}

function cell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** For the screen: "₹1,12,400" with no paise. */
export function moneyWhole(paise: number): string {
  const s = formatMoneyIndian(paise, { withSymbol: false });
  return `₹${s.endsWith('.00') ? s.slice(0, -3) : s}`;
}
