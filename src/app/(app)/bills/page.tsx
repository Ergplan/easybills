import Link from 'next/link';

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
  const [issued, drafts] = await Promise.all([
    listInvoices(business.id, { status: 'issued', limit: 500 }),
    listInvoices(business.id, { status: 'draft', limit: 20 }),
  ]);
  const view = summariseHome({ issued, customers: [], today, recent: 500 });

  return (
    <main className="page">
      <div className="row">
        <Link href="/home" className="btn btn--ghost" aria-label={t('common.back')} style={{ paddingInline: 8 }}>
          <Icon name="back" size={20} />
        </Link>
        <h1 className="grow" style={{ fontSize: '1.3rem' }}>{t('home.sent.title')}</h1>
      </div>

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
          <p className="muted">{t('bills.empty')}</p>
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
    </main>
  );
}

function SentPill({ status }: { status: SentStatus }) {
  const cls = { sent: 'pill--sent', paid: 'pill--paid', partly: 'pill--partly', due: 'pill--unpaid' }[status];
  const key = { sent: 'status.sent', paid: 'status.paid', partly: 'status.partly', due: 'status.due' } as const;
  return <span className={`pill ${cls}`}>{t(key[status])}</span>;
}
