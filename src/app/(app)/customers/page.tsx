import Link from 'next/link';

import { ImportBills } from '@/components/customer/ImportBills';
import { Icon } from '@/components/Icon';
import { Money } from '@/components/Money';
import { CUSTOMER_LANGUAGE_NAMES, t } from '@/lib/copy';
import { initialOf } from '@/lib/domain/home';
import { requireCurrentContext } from '@/server/auth/current';
import { listCustomers } from '@/server/repos/customers';
import { customerBalance } from '@/server/services/bill-search';

export const dynamic = 'force-dynamic';

/** Aapke customers: everyone the owner has billed, and what each still owes. */
export default async function CustomersPage() {
  const { business } = await requireCurrentContext();
  const customers = await listCustomers(business.id);
  const rows = await Promise.all(customers.map(async (c) => ({ c, balance: await customerBalance(business.id, c.id) })));

  return (
    <main className="page">
      <div className="row">
        <Link href="/you" className="btn btn--ghost" aria-label={t('common.back')} style={{ paddingInline: 8 }}>
          <Icon name="back" size={20} />
        </Link>
        <h1 className="grow" style={{ fontSize: '1.3rem' }}>{t('customer.list.title')}</h1>
      </div>
      <ImportBills businessId={business.id} />
      <section className="card stack stack--tight">
        {rows.length === 0 ? (
          <p className="muted">{t('customer.list.empty')}</p>
        ) : (
          <div className="rows">
            {rows.map(({ c, balance }) => (
              <Link key={c.id} href={`/customers/${c.id}`} className="row-line">
                <span className="chip__initial" aria-hidden="true">{initialOf(c.name)}</span>
                <div className="row-line__link">
                  <div className="row-line__name">{c.name}</div>
                  <div className="row-line__meta">
                    {[c.city, c.gstin ? 'GST' : null, c.language && c.language !== 'hi' ? CUSTOMER_LANGUAGE_NAMES[c.language].hi : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                {balance.outstandingPaise > 0 ? (
                  <span className="amount" style={{ color: 'var(--danger)' }}><Money paise={balance.outstandingPaise} whole /></span>
                ) : (
                  <span className="pill pill--paid">{t('customer.settled')}</span>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
