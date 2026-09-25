import Link from 'next/link';

import { Money } from '@/components/Money';
import { TopBar } from '@/components/TopBar';
import { requireCurrentContext } from '@/server/auth/current';
import { listCustomers } from '@/server/repos/customers';
import { customerBalance } from '@/server/services/bill-search';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const { business } = await requireCurrentContext();
  const customers = await listCustomers(business.id);

  const withBalances = await Promise.all(
    customers.map(async (c) => ({ customer: c, balance: await customerBalance(business.id, c.id) })),
  );

  return (
    <>
      <TopBar title="Customers" />
      <main className="page">
        {customers.length === 0 ? (
          <div className="card empty">
            <span className="empty__icon" aria-hidden="true">👥</span>
            <p>No customers yet.</p>
            <p className="small">
              You do not need to add customers first — you can add one while making a bill.
            </p>
            <Link href="/bills/new" className="btn btn--primary" style={{ marginTop: 12 }}>
              Create a bill
            </Link>
          </div>
        ) : (
          <div className="card card--flush">
            <div className="list">
              {withBalances.map(({ customer, balance }) => (
                <Link key={customer.id} href={`/customers/${customer.id}`} className="list__item">
                  <div className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                    <span className="strong truncate">{customer.name}</span>
                    {customer.phone && <span className="faint">{customer.phone}</span>}
                  </div>
                  {balance.outstandingPaise > 0 ? (
                    <div className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
                      <Money paise={balance.outstandingPaise} />
                      <span className="tiny muted">to collect</span>
                    </div>
                  ) : (
                    <span className="pill pill--paid">Settled</span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>
    </>
  );
}
