/**
 * QRMP: quarterly returns with monthly obligations.
 *
 * The trap this module exists to avoid: under QRMP a taxpayer files GSTR-1
 * QUARTERLY, but may optionally furnish the first two months' B2B invoices
 * through the Invoice Furnishing Facility. Anything already furnished through
 * IFF must NOT be reported again in the quarterly return, or the same sale is
 * counted twice.
 *
 * Filing frequency is a property of the taxpayer's registration. It is never
 * inferred from turnover, and this app never enrols anyone in QRMP -- the owner
 * states it at setup, or it comes from an authorised portal read.
 */

import { addMonthsToPeriod, gstQuarterOf, type MonthPeriod } from '@/lib/dates';
import type { FilingFrequency } from '@/lib/domain/types';

export interface QrmpPlan {
  /** Months in the quarter, in order. */
  months: MonthPeriod[];
  /** The period the quarterly return is filed for (the last month). */
  quarterPeriod: MonthPeriod;
  label: string;
  /** Months where IFF is available, when the taxpayer uses it. */
  iffMonths: MonthPeriod[];
  /** Months carrying a payment obligation regardless of the quarterly return. */
  monthlyPaymentMonths: MonthPeriod[];
}

export function qrmpPlan(period: MonthPeriod, usesIff: boolean): QrmpPlan {
  const q = gstQuarterOf(period);
  const months = q.months;
  return {
    months,
    quarterPeriod: months[months.length - 1]!,
    label: q.label,
    // IFF, where used, covers the first two months of the quarter.
    iffMonths: usesIff ? months.slice(0, 2) : [],
    // A quarterly filer still has a monthly payment obligation in months 1 and 2.
    monthlyPaymentMonths: months.slice(0, 2),
  };
}

export interface PeriodObligation {
  period: MonthPeriod;
  forms: Array<{ form: 'GSTR-1' | 'GSTR-3B' | 'IFF'; coversPeriods: MonthPeriod[] }>;
  /** True when a payment is due even though no return is filed this month. */
  paymentOnlyMonth: boolean;
}

/** What a taxpayer actually owes for a given month. */
export function obligationsFor(period: MonthPeriod, frequency: FilingFrequency, usesIff: boolean): PeriodObligation {
  if (frequency === 'monthly') {
    return {
      period,
      forms: [
        { form: 'GSTR-1', coversPeriods: [period] },
        { form: 'GSTR-3B', coversPeriods: [period] },
      ],
      paymentOnlyMonth: false,
    };
  }

  const plan = qrmpPlan(period, usesIff);
  const isQuarterEnd = period === plan.quarterPeriod;

  if (isQuarterEnd) {
    return {
      period,
      forms: [
        { form: 'GSTR-1', coversPeriods: plan.months },
        { form: 'GSTR-3B', coversPeriods: plan.months },
      ],
      paymentOnlyMonth: false,
    };
  }

  const forms: PeriodObligation['forms'] = [];
  if (plan.iffMonths.includes(period)) forms.push({ form: 'IFF', coversPeriods: [period] });
  return { period, forms, paymentOnlyMonth: true };
}

export interface IffFurnishedRecord {
  period: MonthPeriod;
  /** Document numbers already furnished through IFF. */
  documentNumbers: string[];
}

/**
 * Remove from a quarterly set anything already furnished through IFF.
 *
 * Matching is on the document number within the month it was furnished, which
 * is what the portal keys on.
 */
export function excludeIffFurnished<T extends { documentNumber: string; documentDate: string }>(
  documents: readonly T[],
  furnished: readonly IffFurnishedRecord[],
): { included: T[]; excluded: T[] } {
  const furnishedSet = new Set<string>();
  for (const f of furnished) {
    for (const n of f.documentNumbers) furnishedSet.add(`${f.period}|${n}`);
  }

  const included: T[] = [];
  const excluded: T[] = [];
  for (const doc of documents) {
    const period = doc.documentDate.slice(0, 7);
    if (furnishedSet.has(`${period}|${doc.documentNumber}`)) excluded.push(doc);
    else included.push(doc);
  }
  return { included, excluded };
}

/** The next period after this one, for a given frequency. */
export function nextFilingPeriod(period: MonthPeriod, frequency: FilingFrequency): MonthPeriod {
  return frequency === 'monthly' ? addMonthsToPeriod(period, 1) : addMonthsToPeriod(period, 3);
}
