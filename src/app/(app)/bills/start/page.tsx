import Link from 'next/link';

import { CustomerPicker } from '@/components/customer/CustomerPicker';
import { Icon } from '@/components/Icon';
import { TopBar } from '@/components/TopBar';
import { t } from '@/lib/copy';
import { todayIst } from '@/lib/dates';
import { peopleRows } from '@/lib/domain/people';
import { requireCurrentContext } from '@/server/auth/current';
import { loadHome } from '@/server/services/home';

export const dynamic = 'force-dynamic';

/** "Naya bill banana hai" → "Kiska?" One question, then the bill. */
export default async function StartBillPage() {
  const { business } = await requireCurrentContext();
  const home = await loadHome(business.id, todayIst());
  return (
    <>
      <TopBar title={t('start.title')} back={{ href: '/home' }} />
      <main className="page stack">
        <p className="muted">{t(home.allCustomers.length ? 'start.sub' : 'start.subFirst')}</p>
        <section className="card">
          <CustomerPicker customers={peopleRows(home)} mode="bill" autoFocus={home.allCustomers.length > 8} />
        </section>
        <Link href="/bills/help" className="more__item">
          <Icon name="help" size={20} />
          <span>{t('help.entry')}</span>
        </Link>
      </main>
    </>
  );
}
