import Link from 'next/link';

import { Money } from '@/components/Money';
import { t, tCount } from '@/lib/copy';
import { salutationFor } from '@/lib/copy/messages';
import { formatDateShort, todayIst } from '@/lib/dates';
import type { SentStatus } from '@/lib/domain/home';
import { profileSetupStatus } from '@/lib/domain/setup-status';
import { initialOf } from '@/lib/domain/home';
import { requireCurrentContext } from '@/server/auth/current';
import { loadHome } from '@/server/services/home';

import { VoiceButton } from '@/components/voice/VoiceButton';
import { voiceConfig } from '@/lib/env';

import { financialYearOf } from '@/lib/dates';

import { CustomerChips } from './CustomerChips';
import { NewYearBanner } from './NewYearBanner';

export const dynamic = 'force-dynamic';

/**
 * Three questions, three cards, nothing else.
 *
 *   Who do I bill?      Chalo, bill banate hain  -- the customers, as chips
 *   What have I sent?   Bheje hue bills          -- this month, latest first
 *   Who owes me?        Kiske paise aane hain    -- the total, then each one
 *
 * If a feature does not answer one of those, it is not on Home.
 */
export default async function HomePage() {
  const { business } = await requireCurrentContext();
  const today = todayIst();
  const home = await loadHome(business.id, today);
  const setup = profileSetupStatus(business, today);
  const greetName = salutationFor({ name: business.legalName });

  return (
    <main className="page">
      <header className="home__top">
        <div className="grow">
          <div className="home__greet">{t('home.greeting', { name: greetName })}</div>
          {business.city && <div className="home__where">{business.city}</div>}
        </div>
        <Link href="/you" className="avatar" aria-label={t('tab.you')}>
          {initialOf(business.legalName)}
        </Link>
      </header>

      {financialYearOf(today) !== business.activeFinancialYear && (
        <NewYearBanner businessId={business.id} fy={financialYearOf(today)} prefix={business.numbering.prefix} />
      )}

      {!setup.complete && (
        <div className="notice notice--warn">
          <span className="notice__icon" aria-hidden="true">!</span>
          <span className="grow">{t('home.setup')}</span>
          <Link href="/you" className="btn btn--secondary btn--small">{t('home.setup.go')}</Link>
        </div>
      )}

      <div className="deck">
        {/* 1. Chalo, bill banate hain */}
        <section className="card stack" aria-labelledby="bill-heading">
          <div>
            <h2 id="bill-heading" className="card__title">{t('home.bill.title')}</h2>
            <p className="card__sub">{home.customers.length ? t('home.bill.sub') : t('home.bill.subEmpty')}</p>
          </div>
          <CustomerChips customers={home.customers.map((c) => ({ id: c.id, name: c.name }))} />
          <VoiceButton
            businessId={business.id}
            enabled={voiceConfig().enabled}
            customers={home.customers.map((c) => ({ id: c.id, name: c.name }))}
            due={home.due.map((d) => ({ invoiceId: d.id, customerId: d.customerId, customerName: d.customerName, amountPaise: d.balancePaise, days: d.days }))}
          />
        </section>

        {/* 2. Bheje hue bills */}
        <section className="card stack" aria-labelledby="sent-heading">
          <div>
            <h2 id="sent-heading" className="card__title">{t('home.sent.title')}</h2>
            <p className="card__sub">
              {tCount(home.sentThisMonth, { zero: 'home.sent.subEmpty', one: 'home.sent.subOne', many: 'home.sent.sub' })}
            </p>
          </div>
          {home.recentSent.length > 0 && (
            <div className="rows">
              {home.recentSent.map((row) => (
                <Link key={row.id} href={`/bills/${row.id}`} className="row-line">
                  <div className="row-line__link">
                    <div className="row-line__name">{row.customerName}</div>
                    <div className="row-line__meta">{row.number} · {formatDateShort(row.issueDate)}</div>
                  </div>
                  <Money paise={row.grandTotalPaise} whole />
                  <SentPill status={row.status} />
                </Link>
              ))}
            </div>
          )}
          {home.recentSent.length > 0 && (
            <Link href="/bills" className="btn btn--ghost" style={{ alignSelf: 'flex-start' }}>
              {t('common.seeAll')}
            </Link>
          )}
        </section>

        {/* 3. Kiske paise aane hain */}
        <section className="card stack" aria-labelledby="due-heading">
          <div>
            <h2 id="due-heading" className="card__title">{t('home.due.title')}</h2>
            {home.due.length > 0 && <div className="home__big amount"><Money paise={home.duePaise} whole /></div>}
            <p className="card__sub">
              {tCount(
                home.dueFrom,
                { zero: 'home.due.subEmpty', one: 'home.due.subOne', many: 'home.due.sub' },
                { days: home.oldestDays },
              )}
            </p>
          </div>
          {home.due.length > 0 && (
            <div className="rows">
              {home.due.map((row) => (
                <div key={row.id} className="row-line">
                  <Link href={`/bills/${row.id}`} className="row-line__link">
                    <div className="row-line__name">{row.customerName}</div>
                    <div className="row-line__meta">{ageLine(row.days)} · {row.number}</div>
                  </Link>
                  <Money paise={row.balancePaise} whole />
                  <Link href={`/bills/${row.id}/remind`} className="btn btn--secondary btn--small">
                    {t('remind.button')}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ageLine(days: number): string {
  if (days === 0) return t('home.due.ageToday');
  if (days === 1) return t('home.due.ageOne');
  return t('home.due.ageDays', { days });
}

function SentPill({ status }: { status: SentStatus }) {
  const map: Record<SentStatus, { cls: string; key: 'status.sent' | 'status.paid' | 'status.partly' | 'status.due' }> = {
    sent: { cls: 'pill--sent', key: 'status.sent' },
    paid: { cls: 'pill--paid', key: 'status.paid' },
    partly: { cls: 'pill--partly', key: 'status.partly' },
    due: { cls: 'pill--unpaid', key: 'status.due' },
  };
  const { cls, key } = map[status];
  return <span className={`pill ${cls}`}>{t(key)}</span>;
}
