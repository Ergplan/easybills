import 'server-only';

import { todayIst, compareDates, type CivilDate } from '@/lib/dates';
import type { InvoiceRecord } from '@/lib/domain/types';
import { invoicesCol, schedulesCol } from '@/server/firebase/paths';

/**
 * Everything Home needs, in one read pass.
 *
 * Home shows three things and no charts: one primary action, the monthly drafts
 * waiting for review, and the money still to collect. Anything else competing
 * for attention here makes the next action harder to see.
 */
export interface HomeSummary {
  moneyToCollectPaise: number;
  overdueCount: number;
  overduePaise: number;
  unpaidCount: number;
  monthlyDraftsReady: number;
  monthlyDraftIds: string[];
  recentDrafts: Array<Pick<InvoiceRecord, 'id' | 'customer' | 'totals' | 'updatedAt'>>;
  hasAnyInvoice: boolean;
  activeScheduleCount: number;
}

export async function loadHomeSummary(businessId: string, today: CivilDate = todayIst()): Promise<HomeSummary> {
  const [issuedSnap, draftSnap, schedulesSnap] = await Promise.all([
    invoicesCol(businessId).where('status', '==', 'issued').limit(500).get(),
    invoicesCol(businessId).where('status', '==', 'draft').orderBy('updatedAt', 'desc').limit(100).get(),
    schedulesCol(businessId).where('status', '==', 'active').limit(100).get(),
  ]);

  const issued = issuedSnap.docs.map((d) => d.data() as InvoiceRecord);
  const drafts = draftSnap.docs.map((d) => d.data() as InvoiceRecord);

  let moneyToCollectPaise = 0;
  let overdueCount = 0;
  let overduePaise = 0;
  let unpaidCount = 0;

  for (const inv of issued) {
    if (inv.balancePaise <= 0) continue;
    moneyToCollectPaise += inv.balancePaise;
    unpaidCount += 1;
    if (inv.dueDate && compareDates(inv.dueDate, today) < 0) {
      overdueCount += 1;
      overduePaise += inv.balancePaise;
    }
  }

  // "Monthly bills ready" counts drafts the recurrence worker prepared, not
  // every draft the owner happens to have open.
  const monthlyDrafts = drafts.filter((d) => d.scheduleId !== null);

  return {
    moneyToCollectPaise,
    overdueCount,
    overduePaise,
    unpaidCount,
    monthlyDraftsReady: monthlyDrafts.length,
    monthlyDraftIds: monthlyDrafts.map((d) => d.id),
    recentDrafts: drafts
      .filter((d) => d.scheduleId === null)
      .slice(0, 5)
      .map((d) => ({ id: d.id, customer: d.customer, totals: d.totals, updatedAt: d.updatedAt })),
    hasAnyInvoice: issued.length > 0 || drafts.length > 0,
    activeScheduleCount: schedulesSnap.size,
  };
}
