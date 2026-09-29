import Link from 'next/link';

import { Money } from '@/components/Money';
import { TopBar } from '@/components/TopBar';
import { t } from '@/lib/copy';
import { formatDateShort, todayIst } from '@/lib/dates';
import { initialOf } from '@/lib/domain/home';
import { requireCurrentContext } from '@/server/auth/current';
import { loadHome } from '@/server/services/home';

export const dynamic = 'force-dynamic';

/** "Kiske paise aane hain": the total, then each unpaid bill, oldest first, with what to do next. */
export default async function DuesPage() {
  const { business } = await requireCurrentContext();
  const home = await loadHome(business.id, todayIst());
  return (
    <>
      <TopBar title={t('dues.title')} back={{ href: '/home' }} />
      <main className="page stack">
        {home.due.length === 0 ? (
          <section className="card stack">
            <p className="dues__none">{t(home.recentSent.length ? 'dues.none' : 'dues.noBills')}</p>
            {!home.recentSent.length && (
              <Link href="/bills/start" className="btn btn--primary btn--block">{t('bills.first')}</Link>
            )}
          </section>
        ) : (
          <>
            <section className="card dues__total">
              <span className="muted">{t('dues.total')}</span>
              <span className="dues__amount amount"><Money paise={home.duePaise} whole /></span>
              <span className="faint">
                {home.dueFrom === 1
                  ? t('home.due.subOne', { days: home.oldestDays })
                  : t('home.due.sub', { n: home.dueFrom, days: home.oldestDays })}
              </span>
            </section>
            <section className="card stack stack--tight">
              <div className="rows">
                {home.due.map((row) => (
                  <div key={row.id} className="due-row">
                    <Link href={`/bills/${row.id}`} className="due-row__who">
                      <span className="person__initial" aria-hidden="true">{initialOf(row.customerName)}</span>
                      <span className="person__text">
                        <span className="person__name">{row.customerName}</span>
                        <span className="person__meta">
                          {row.number} · {formatDateShort(row.issueDate)} · {ageLine(row.days)}
                        </span>
                      </span>
                      <span className="due-row__amount"><Money paise={row.balancePaise} whole /></span>
                    </Link>
                    <div className="due-row__actions">
                      <Link href={`/bills/${row.id}/remind`} className="btn btn--secondary btn--small">{t('remind.button')}</Link>
                      <Link href={`/bills/${row.id}#paid`} className="btn btn--ghost btn--small">{t('dues.paid')}</Link>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}

function ageLine(days: number): string {
  if (days === 0) return t('home.due.ageToday');
  if (days === 1) return t('home.due.ageOne');
  return t('home.due.ageDays', { days });
}
