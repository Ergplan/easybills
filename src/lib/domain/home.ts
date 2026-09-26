/**
 * What Home shows, worked out from the records.
 *
 * Three questions, three cards: who do I bill (the customers, most recent
 * first), what have I sent (this month's bills), who owes me (every unpaid
 * bill, oldest first, and the total). Pure, so the arithmetic is tested
 * without a database and the page only lays it out.
 */
import { compareDates, daysBetween, partsOf, type CivilDate } from '@/lib/dates';
import type { CustomerRecord, InvoiceRecord } from '@/lib/domain/types';

/** The word on a sent bill's pill. Paid, partly, or still to come. */
export type SentStatus = 'sent' | 'paid' | 'partly' | 'due';

export interface SentRow {
  id: string;
  number: string;
  customerName: string;
  issueDate: CivilDate;
  grandTotalPaise: number;
  status: SentStatus;
}

export interface DueRow {
  id: string;
  number: string;
  customerName: string;
  customerId: string | null;
  issueDate: CivilDate;
  balancePaise: number;
  /** Days since the bill went out. What the owner counts, not days past a due date. */
  days: number;
}

export interface HomeView {
  /** Customers to offer as chips, most recently billed first. */
  customers: CustomerRecord[];
  sentThisMonth: number;
  recentSent: SentRow[];
  duePaise: number;
  due: DueRow[];
  /** How many different people the money is owed by. */
  dueFrom: number;
  /** Age of the oldest unpaid bill, in days. Zero when nothing is due. */
  oldestDays: number;
}

const CHIPS = 8;
const RECENT = 4;

export function summariseHome(args: {
  issued: InvoiceRecord[];
  customers: CustomerRecord[];
  today: CivilDate;
  /** How many sent bills to list. Home shows a few; the bills page, all. */
  recent?: number;
}): HomeView {
  const { today } = args;
  const issued = args.issued
    .filter((inv) => inv.status === 'issued' && inv.number)
    .sort((a, b) => compareDates(b.issueDate, a.issueDate) || (b.numberSequence ?? 0) - (a.numberSequence ?? 0));

  const { year, month } = partsOf(today);
  const sentThisMonth = issued.filter((inv) => {
    const p = partsOf(inv.issueDate);
    return p.year === year && p.month === month;
  }).length;

  const recentSent: SentRow[] = issued.slice(0, args.recent ?? RECENT).map((inv) => ({
    id: inv.id,
    number: inv.number!,
    customerName: inv.customer.name,
    issueDate: inv.issueDate,
    grandTotalPaise: inv.totals.grandTotalPaise,
    status: sentStatus(inv, today),
  }));

  const unpaid = issued.filter((inv) => inv.balancePaise > 0).sort((a, b) => compareDates(a.issueDate, b.issueDate));
  const due: DueRow[] = unpaid.map((inv) => ({
    id: inv.id,
    number: inv.number!,
    customerName: inv.customer.name,
    customerId: inv.customer.customerId,
    issueDate: inv.issueDate,
    balancePaise: inv.balancePaise,
    days: Math.max(0, daysBetween(inv.issueDate, today)),
  }));
  const duePaise = due.reduce((sum, row) => sum + row.balancePaise, 0);
  const dueFrom = new Set(due.map((row) => row.customerId ?? `name:${row.customerName.trim().toLowerCase()}`)).size;

  const customers = [...args.customers]
    .filter((c) => !c.archived)
    .sort((a, b) => {
      // Billed recently first; never-billed after, by name, so a new customer
      // still has a chip before their first bill.
      if (a.lastBilledAt && b.lastBilledAt) return a.lastBilledAt < b.lastBilledAt ? 1 : -1;
      if (a.lastBilledAt) return -1;
      if (b.lastBilledAt) return 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, CHIPS);

  return {
    customers,
    sentThisMonth,
    recentSent,
    duePaise,
    due,
    dueFrom,
    oldestDays: due[0]?.days ?? 0,
  };
}

/**
 * "Bheja" while the money is not late yet, "Baaki" once the due date has gone.
 * A bill with no due date is never late, only unpaid.
 */
function sentStatus(inv: InvoiceRecord, today: CivilDate): SentStatus {
  if (inv.balancePaise <= 0) return 'paid';
  if (inv.amountPaidPaise > 0 || inv.creditAppliedPaise > 0) return 'partly';
  if (inv.dueDate && compareDates(inv.dueDate, today) < 0) return 'due';
  return 'sent';
}

/** "S" for Sharma Electricals, "G" for Green Park Society: the chip's initial. */
export function initialOf(name: string): string {
  const cleaned = name.trim().replace(/^(mr|mrs|ms|dr|shri|smt|sri)\.?\s+/i, '');
  const first = [...cleaned][0];
  return first ? first.toUpperCase() : '?';
}
