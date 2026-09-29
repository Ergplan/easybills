import 'server-only';

import { todayIst, type CivilDate } from '@/lib/dates';
import { summariseHome, type HomeView } from '@/lib/domain/home';
import type { CustomerRecord, InvoiceRecord } from '@/lib/domain/types';
import { listCustomers } from '@/server/repos/customers';
import { listIssued } from '@/server/repos/invoices';

/**
 * Everything Home needs, in two reads that run together.
 *
 * Issued bills are fetched whole and summed in memory: a business this app is
 * for sends fifty a year, so a query per card would be three round trips for
 * what one returns.
 */
export async function loadHome(businessId: string, today: CivilDate = todayIst()): Promise<HomeView> {
  const [issued, customers] = await Promise.all([
    listIssued(businessId, 500) as Promise<InvoiceRecord[]>,
    listCustomers(businessId, { limit: 200 }) as Promise<CustomerRecord[]>,
  ]);
  return summariseHome({ issued, customers, today });
}
