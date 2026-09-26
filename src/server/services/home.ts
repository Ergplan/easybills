import 'server-only';

import { todayIst, type CivilDate } from '@/lib/dates';
import { summariseHome, type HomeView } from '@/lib/domain/home';
import type { CustomerRecord, InvoiceRecord } from '@/lib/domain/types';
import { customersCol, invoicesCol } from '@/server/firebase/paths';

/**
 * Everything Home needs, in two reads that run together.
 *
 * Issued bills are fetched whole and sorted in memory: a business this app is
 * for sends fifty a year, so a query per card would be three round trips to
 * Mumbai for what one returns.
 */
export async function loadHome(businessId: string, today: CivilDate = todayIst()): Promise<HomeView> {
  const [issuedSnap, customersSnap] = await Promise.all([
    invoicesCol(businessId).where('status', '==', 'issued').limit(500).get(),
    customersCol(businessId).where('archived', '==', false).limit(200).get(),
  ]);
  return summariseHome({
    issued: issuedSnap.docs.map((d) => d.data() as InvoiceRecord),
    customers: customersSnap.docs.map((d) => d.data() as CustomerRecord),
    today,
  });
}
