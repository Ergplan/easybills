/**
 * The bill as the owner types it: what did you do, how many, at what rate.
 *
 * Three fields per line and nothing the engine needs that the owner does not
 * already know. The rate is rupees; the quantity is a count; the description is
 * whatever they would have written on paper. This module turns that into the
 * lines the pricing engine takes, and says in Hinglish what is missing.
 */
import { t } from '@/lib/copy';
import type { InvoiceLine } from '@/lib/domain/types';
import { MoneyError, formatMoneyPlain, formatQuantityPlain, parseMoney, parseQuantity } from '@/lib/money';

export interface LineDraft {
  id: string;
  /** "Kya kiya?" */
  what: string;
  /** "Kitna": a count, as typed. "1" by default. */
  qty: string;
  /** "Rate (₹)": rupees, as typed. */
  rate: string;
}

export interface BillDraft {
  customerName: string;
  customerPhone: string;
  /** Only asked when the owner charges GST: it decides IGST or CGST+SGST. */
  customerGstin: string;
  lines: LineDraft[];
  /** Basis points, one rate for the whole bill. Only asked of a GST-registered owner. */
  gstRateBp: number | null;
}

export type BillProblem =
  | { field: 'customerName' }
  | { field: 'lines' }
  | { field: 'what' | 'qty' | 'rate'; lineId: string };

export type BillCheck = { ok: true; lines: InvoiceLine[] } | { ok: false; problem: BillProblem; message: string };

export function blankLine(id: string): LineDraft {
  return { id, what: '', qty: '1', rate: '' };
}

/** A line the owner has not touched. Skipped rather than complained about. */
export function isBlankLine(line: LineDraft): boolean {
  return !line.what.trim() && !line.rate.trim();
}

/**
 * The lines, priced in paise, or the first thing wrong. A line with nothing
 * in it is ignored, so "+ Aur kuch" never leaves a bill un-makeable; a line
 * with a description and no rate is a question, not a mistake to hide.
 */
export function checkBill(draft: BillDraft, opts: { needsCustomerName: boolean; chargesGst: boolean }): BillCheck {
  if (opts.needsCustomerName && !draft.customerName.trim()) {
    return { ok: false, problem: { field: 'customerName' }, message: t('error.required') };
  }
  const filled = draft.lines.filter((l) => !isBlankLine(l));
  if (!filled.length) return { ok: false, problem: { field: 'lines' }, message: t('bill.noLines') };

  const lines: InvoiceLine[] = [];
  for (const line of filled) {
    if (!line.what.trim()) return { ok: false, problem: { field: 'what', lineId: line.id }, message: t('error.required') };
    let quantityMilli: number;
    let unitPricePaise: number;
    try {
      quantityMilli = parseQuantity(line.qty || '1');
      if (quantityMilli <= 0) throw new MoneyError('zero');
    } catch {
      return { ok: false, problem: { field: 'qty', lineId: line.id }, message: t('error.qty') };
    }
    try {
      unitPricePaise = parseMoney(line.rate);
      if (unitPricePaise < 0) throw new MoneyError('negative');
    } catch {
      return { ok: false, problem: { field: 'rate', lineId: line.id }, message: t('error.amount') };
    }
    lines.push({
      id: line.id,
      description: line.what.trim(),
      quantityMilli,
      unitPricePaise,
      discountPaise: 0,
      taxRateBp: opts.chargesGst ? (draft.gstRateBp ?? 0) : 0,
      // For an owner who does not charge GST the rate is not a question; for
      // one who does, the bill-level select answers it for every line.
      taxRateChosen: !opts.chargesGst || draft.gstRateBp !== null,
      cessRateBp: 0,
      priceIncludesTax: false,
      unit: null,
      hsnCode: null,
      savedItemId: null,
    });
  }
  return { ok: true, lines };
}

/** Last time's lines, back into the three fields, for "Pichle jaisa hi?". */
export function linesToDraft(lines: readonly InvoiceLine[], newId: () => string): LineDraft[] {
  return lines.map((l) => ({
    id: newId(),
    what: l.description,
    qty: formatQuantityPlain(l.quantityMilli),
    rate: formatMoneyPlain(l.unitPricePaise).replace(/\.00$/, ''),
  }));
}

/** "AMC visit + 2 fans": last time's bill in a few words, for the offer. */
export function summariseLines(lines: readonly InvoiceLine[]): string {
  const parts = lines.slice(0, 3).map((l) => {
    const qty = l.quantityMilli === 1000 ? '' : `${formatQuantityPlain(l.quantityMilli)} `;
    return `${qty}${l.description}`.trim();
  });
  const more = lines.length > 3 ? ` + ${lines.length - 3}` : '';
  return parts.join(' + ') + more;
}

/** The running total as the owner types, before GST. Only the well-formed lines count. */
export function subtotalOf(lines: readonly LineDraft[]): number {
  let total = 0;
  for (const line of lines) {
    if (isBlankLine(line)) continue;
    try {
      const qty = parseQuantity(line.qty || '1');
      const rate = parseMoney(line.rate || '0');
      total += Math.round((qty * rate) / 1000);
    } catch {
      // Half-typed; counted once it makes sense.
    }
  }
  return total;
}
