import Link from 'next/link';

import { TopBar } from '@/components/TopBar';
import { requireCurrentContext } from '@/server/auth/current';
import { searchBills, type BillFilter } from '@/server/services/bill-search';

import { BillsList } from './BillsList';

export const dynamic = 'force-dynamic';

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; status?: string; q?: string }>;
}) {
  const params = await searchParams;
  const { business } = await requireCurrentContext();

  const requested = (params.filter ?? params.status ?? 'all') as BillFilter;
  const filter: BillFilter = ['all', 'draft', 'unpaid', 'paid', 'monthly'].includes(requested) ? requested : 'all';

  const bills = await searchBills(business.id, { filter, query: params.q ?? '' });

  return (
    <>
      <TopBar
        title="Bills"
        action={
          <Link href="/bills/new" className="btn btn--primary" style={{ padding: '10px 14px' }}>
            + New
          </Link>
        }
      />
      <main className="page">
        <BillsList businessId={business.id} initialBills={bills} filter={filter} query={params.q ?? ''} />
      </main>
    </>
  );
}
