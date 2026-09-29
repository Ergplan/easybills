import Link from 'next/link';
import { TopBar } from '@/components/TopBar';

import { CustomerPicker } from '@/components/customer/CustomerPicker';
import { ImportBills } from '@/components/customer/ImportBills';
import { todayIst } from '@/lib/dates';
import { peopleRows } from '@/lib/domain/people';
import { loadHome } from '@/server/services/home';
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
  const people = peopleRows(await loadHome(business.id, todayIst()));

  return (
    <>
    <TopBar title={t('customer.list.title')} back={{ href: '/home' }} />
    <main className="page">
      <Link href="/customers/new" className="person person--new" data-testid="customer-new">
        <span className="person__initial" aria-hidden="true">
          <Icon name="plus" size={20} />
        </span>
        <span className="person__text">
          <span className="person__name">{t('home.bill.newCustomer')}</span>
          <span className="person__meta">{t('customer.new.sub')}</span>
        </span>
        <Icon name="chevron" size={18} className="person__go" />
      </Link>
      <section className="card">
        <CustomerPicker customers={people} mode="open" />
      </section>
      <ImportBills businessId={business.id} fy={business.activeFinancialYear} />
    </main>
    </>
  );
}
