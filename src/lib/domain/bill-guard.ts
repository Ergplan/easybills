/**
 * The checks around a bill that an owner with paper would do by memory:
 * "didn't I bill them this already?", "wasn't it 3,500 last time, not
 * 350?", "what number am I on?". Pure, so every one is tested on its own
 * and the screens only ask.
 */
import { compareDates, daysBetween, type CivilDate, type FinancialYear } from '@/lib/dates';
import type { LineDraft } from '@/lib/domain/bill-form';
import type { InvoiceLine, InvoiceRecord, InvoiceTotals, NumberingSeries } from '@/lib/domain/types';

export interface DuplicateHit {
  id: string;
  number: string;
  issueDate: CivilDate;
  grandTotalPaise: number;
}

function normName(s: string): string {
  return s.toLowerCase().replace(/\(sample\)/g, '').replace(/[^a-z0-9]/g, '');
}

/**
 * A bill that looks like this one, already issued to the same customer for
 * the same amount within the last week. Same customer and same total is a
 * strong sign for a business that bills each customer about once a month;
 * the owner is asked, not blocked, because two identical jobs in a week
 * do happen.
 */
export function findDuplicate(
  candidate: { customerId: string | null; customerName: string; grandTotalPaise: number; today: CivilDate },
  recent: readonly InvoiceRecord[],
  withinDays = 7,
): DuplicateHit | null {
  const hits = recent
    .filter((inv) => inv.status === 'issued' && inv.number)
    .filter((inv) =>
      candidate.customerId
        ? inv.customer.customerId === candidate.customerId
        : normName(inv.customer.name) === normName(candidate.customerName),
    )
    .filter((inv) => inv.totals.grandTotalPaise === candidate.grandTotalPaise)
    .filter((inv) => {
      const age = daysBetween(inv.issueDate, candidate.today);
      return age >= 0 && age <= withinDays;
    })
    .sort((a, b) => compareDates(b.issueDate, a.issueDate));
  const hit = hits[0];
  return hit ? { id: hit.id, number: hit.number!, issueDate: hit.issueDate, grandTotalPaise: hit.totals.grandTotalPaise } : null;
}

export interface RateOddity {
  what: string;
  lastRatePaise: number;
  nowRatePaise: number;
}

/**
 * A line whose rate is wildly off what the same thing cost last time --
 * four times more or a quarter as much -- is usually a missing or extra
 * zero. Shown, not corrected: the owner knows if the price really changed.
 */
export function rateOddities(lines: readonly LineDraft[], last: readonly InvoiceLine[]): RateOddity[] {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const out: RateOddity[] = [];
  for (const line of lines) {
    const rupees = Number(line.rate.replace(/,/g, ''));
    if (!line.what.trim() || !Number.isFinite(rupees) || rupees <= 0) continue;
    const nowPaise = Math.round(rupees * 100);
    const prior = last.find((l) => key(l.description) === key(line.what) && l.unitPricePaise > 0);
    if (!prior) continue;
    const ratio = nowPaise / prior.unitPricePaise;
    if (ratio >= 4 || ratio <= 0.25) out.push({ what: line.what, lastRatePaise: prior.unitPricePaise, nowRatePaise: nowPaise });
  }
  return out;
}

/** The number the next bill will get, given the series and the year. Mirrors the engine. */
export function previewNumber(series: NumberingSeries, fy: FinancialYear): string {
  const padded = String(series.nextNumber).padStart(series.padding, '0');
  return `${series.prefix}${series.includeFinancialYear ? `${fy}/` : ''}${padded}`;
}

/**
 * From the numbers on the old bills the owner uploaded, what the next one
 * should be: the same prefix, the year segment if they used one, and one
 * more than the highest. "INV/2025-26/042" -> INV/, with the year, 043.
 */
export function suggestNumbering(numbers: readonly (string | null | undefined)[]): { series: NumberingSeries; last: string } | null {
  const parsed = numbers
    .filter((n): n is string => typeof n === 'string' && /\d/.test(n))
    .map((raw) => {
      const m = /^(.*?)(\d+)\s*$/.exec(raw.trim());
      if (!m) return null;
      const seq = Number(m[2]);
      let prefix = m[1]!;
      const fyMatch = /(\d{4}-\d{2}|\d{2}-\d{2}|\d{4})[\/\-]$/.exec(prefix);
      const includeFinancialYear = Boolean(fyMatch);
      if (fyMatch) prefix = prefix.slice(0, -fyMatch[0].length);
      if (!/^[A-Za-z0-9\/\-]*$/.test(prefix) || prefix.length > 10) return null;
      return { raw: raw.trim(), prefix, seq, padding: m[2]!.length, includeFinancialYear };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null && Number.isFinite(p.seq));
  if (!parsed.length) return null;
  // The most common prefix wins; the highest number under it is "last".
  const byPrefix = new Map<string, typeof parsed>();
  for (const p of parsed) byPrefix.set(p.prefix, [...(byPrefix.get(p.prefix) ?? []), p]);
  const [prefix, group] = [...byPrefix.entries()].sort((a, b) => b[1].length - a[1].length)[0]!;
  const top = [...group].sort((a, b) => b.seq - a.seq)[0]!;
  return {
    last: top.raw,
    series: { prefix, nextNumber: top.seq + 1, padding: Math.max(1, Math.min(8, top.padding)), includeFinancialYear: top.includeFinancialYear },
  };
}

/**
 * A credit note for part of a bill reduces the taxable value and each tax
 * head in the bill's own proportion, so the GST summary stays consistent
 * with the bill it corrects. Rounded to the paisa; the remainder lands on
 * the taxable value so the parts add up to the note.
 */
export function proportionalCredit(totals: InvoiceTotals, amountPaise: number) {
  const grand = totals.grandTotalPaise;
  if (grand <= 0 || amountPaise <= 0) return { taxableValuePaise: amountPaise, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 0 };
  const share = (part: number) => Math.round((part * amountPaise) / grand);
  const cgstPaise = share(totals.cgstPaise);
  const sgstPaise = share(totals.sgstPaise);
  const igstPaise = share(totals.igstPaise);
  const cessPaise = share(totals.cessPaise);
  return { taxableValuePaise: amountPaise - cgstPaise - sgstPaise - igstPaise - cessPaise, cgstPaise, sgstPaise, igstPaise, cessPaise };
}
