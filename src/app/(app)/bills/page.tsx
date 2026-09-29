import Link from 'next/link';

import { TopBar } from '@/components/TopBar';

import { Money } from '@/components/Money';
import { Icon } from '@/components/Icon';
import { t } from '@/lib/copy';
import { formatDateShort, todayIst } from '@/lib/dates';
import { summariseHome, type SentStatus } from '@/lib/domain/home';
import { requireCurrentContext } from '@/server/auth/current';
import { listInvoices } from '@/server/repos/invoices';

export const dynamic = 'force-dynamic';

/**
 * Every bill that went out, newest first, and the unfinished ones above
 * them. No search, no filters: fifty bills a year is one screen.
 */
export default async function BillsPage() {
  const { business } = await requireCurrentContext();
  const today = todayIst();
  const [issued, drafts, cancelled] = await Promise.all([
    listInvoices(business.id, { status: 'issued', limit: 500 }),
    listInvoices(business.id, { status: 'draft', limit: 20 }),
    listInvoices(business.id, { status: 'cancelled', limit: 50 }),
  ]);
  const view = summariseHome({ issued, customers: [], today, recent: 500 });

  return (
    <>
    <TopBar title={t('home.sent.title')} back={{ href: '/home' }} />
    <main className="page">

      {drafts.filter((d) => d.lines.some((l) => l.description)).length > 0 && (
        <section className="card stack stack--tight">
          <h2 className="card__title" style={{ fontSize: '1.1rem' }}>{t('bills.drafts')}</h2>
          <div className="rows">
            {drafts
              .filter((d) => d.lines.some((l) => l.description))
              .map((d) => (
                <Link key={d.id} href={`/bills/${d.id}`} className="row-line">
                  <div className="row-line__link">
                    <div className="row-line__name">{d.customer.name || t('bill.titleNew')}</div>
                    <div className="row-line__meta">{t('status.draft')}</div>
                  </div>
                  <span className="btn btn--secondary btn--small">{t('bills.draft.open')}</span>
                </Link>
              ))}
          </div>
        </section>
      )}

      <section className="card stack stack--tight">
        {view.recentSent.length === 0 ? (
          <div className="stack">
            <p className="muted">{t('bills.empty')}</p>
            <Link href="/bills/start" className="btn btn--primary btn--block">{t('bills.first')}</Link>
          </div>
        ) : (
          <div className="rows">
            {view.recentSent.map((row) => (
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
      </section>
      {cancelled.length > 0 && (
        <section className="card stack stack--tight">
          <h2 className="card__title" style={{ fontSize: '1.1rem' }}>{t('bills.cancelled')}</h2>
          <div className="rows">
            {cancelled.map((c) => (
              <Link key={c.id} href={`/bills/${c.id}`} className="row-line">
                <div className="row-line__link">
                  <div className="row-line__name">{c.customer.name}</div>
                  <div className="row-line__meta">{c.number} · {c.cancelledReason ?? ''}</div>
                </div>
                <span className="pill pill--draft">{t('fix.cancelled')}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
    </>
  );
}

function SentPill({ status }: { status: SentStatus }) {
  const cls = { sent: 'pill--sent', paid: 'pill--paid', partly: 'pill--partly', due: 'pill--unpaid' }[status];
  const key = { sent: 'status.sent', paid: 'status.paid', partly: 'status.partly', due: 'status.due' } as const;
  return <span className={`pill ${cls}`}>{t(key[status])}</span>;
}
