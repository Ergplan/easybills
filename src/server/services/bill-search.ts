import 'server-only';

import { compareDates, todayIst, type CivilDate } from '@/lib/dates';
import type { InvoiceRecord } from '@/lib/domain/types';
import { listAllByIssueDate, listIssuedForCustomer } from '@/server/repos/invoices';

/**
 * Bills list: a search box and three filters. That is the whole feature.
 *
 * Matching is done in the application rather than through a text-search index
 * because a very small business has hundreds of bills, not millions, and an
 * extra piece of infrastructure would cost more than it returns here.
 */
export type BillFilter = 'all' | 'draft' | 'unpaid' | 'paid' | 'monthly';

export interface BillListItem {
  id: string;
  number: string | null;
  status: InvoiceRecord['status'];
  paymentStatus: InvoiceRecord['paymentStatus'];
  customerName: string;
  issueDate: CivilDate;
  dueDate: CivilDate | null;
  grandTotalPaise: number;
  balancePaise: number;
  isOverdue: boolean;
  fromSchedule: boolean;
}

export async function searchBills(
  businessId: string,
  opts: { filter?: BillFilter; query?: string; limit?: number } = {},
): Promise<BillListItem[]> {
  const today = todayIst();
  const all = await listAllByIssueDate(businessId, opts.limit ?? 300);

  let items = all
    .map((inv): BillListItem => ({
      id: inv.id,
      number: inv.number,
      status: inv.status,
      paymentStatus: inv.paymentStatus,
      customerName: inv.customer.name,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      grandTotalPaise: inv.totals.grandTotalPaise,
      balancePaise: inv.balancePaise,
      isOverdue:
        inv.status === 'issued' && inv.balancePaise > 0 && Boolean(inv.dueDate) && compareDates(inv.dueDate!, today) < 0,
      fromSchedule: inv.scheduleId !== null,
    }));

  switch (opts.filter) {
    case 'draft':
      items = items.filter((i) => i.status === 'draft');
      break;
    case 'unpaid':
      items = items.filter((i) => i.status === 'issued' && i.balancePaise > 0);
      break;
    case 'paid':
      items = items.filter((i) => i.status === 'issued' && i.balancePaise <= 0);
      break;
    case 'monthly':
      items = items.filter((i) => i.fromSchedule && i.status === 'draft');
      break;
    default:
      break;
  }

  const q = (opts.query ?? '').trim().toLowerCase();
  if (q) {
    items = items.filter(
      (i) =>
        i.customerName.toLowerCase().includes(q) ||
        (i.number ?? '').toLowerCase().includes(q) ||
        i.issueDate.includes(q),
    );
  }

  return items;
}

export interface CustomerBalance {
  outstandingPaise: number;
  overduePaise: number;
  invoiceCount: number;
}

export async function customerBalance(businessId: string, customerId: string): Promise<CustomerBalance> {
  const today = todayIst();
  const issued = await listIssuedForCustomer(businessId, customerId);

  let outstandingPaise = 0;
  let overduePaise = 0;
  for (const inv of issued) {
    if (inv.balancePaise <= 0) continue;
    outstandingPaise += inv.balancePaise;
    if (inv.dueDate && compareDates(inv.dueDate, today) < 0) overduePaise += inv.balancePaise;
  }
  return { outstandingPaise, overduePaise, invoiceCount: issued.length };
}
