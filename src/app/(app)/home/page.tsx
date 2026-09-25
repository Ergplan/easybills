import Link from 'next/link';

import { formatPeriodLong, monthPeriodOf, todayIst } from '@/lib/dates';
import { profileSetupStatus } from '@/lib/domain/setup-status';
import { Money } from '@/components/Money';
import { TopBar } from '@/components/TopBar';
import { requireCurrentContext } from '@/server/auth/current';
import { loadHomeSummary } from '@/server/services/home-summary';
import { gstModuleVisibility } from '@/server/services/gst-visibility';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const { business } = await requireCurrentContext();
  const summary = await loadHomeSummary(business.id);
  const gst = gstModuleVisibility(business);
  const today = todayIst();

  // Asks the same question issuance asks, so the banner cannot outlive the
  // problem it describes.
  const setup = profileSetupStatus(business, today);

  return (
    <>
      <TopBar title={business.legalName} wideTitle="Home" showProfile />
      <main className="page">
        {/* The one primary action. Nothing competes with it visually. */}
        <Link href="/bills/new" className="btn btn--primary btn--block btn--large">
          + Create bill
        </Link>

        {!setup.complete && (
          <div className="notice notice--warn">
            <span className="notice__icon" aria-hidden="true">!</span>
            <div className="stack" style={{ gap: 6 }}>
              <span>{setup.headline}</span>
              <span className="small">
                You can carry on writing bills in the meantime — you just cannot issue one yet.
              </span>
              <Link href="/settings" className="btn btn--secondary" style={{ alignSelf: 'flex-start' }}>
                Finish business setup
              </Link>
            </div>
          </div>
        )}

        {/* Four cards that each say one thing. On a phone they stack; in a
            browser window they sit two across, so the whole of today is read
            in one glance instead of a long scroll. */}
        <div className="deck">
        {/* Monthly bills ready */}
        <section className="card stack" aria-labelledby="monthly-heading">
          <div className="row row--between">
            <h2 id="monthly-heading">Monthly bills ready</h2>
            {summary.monthlyDraftsReady > 0 && (
              <span className="pill pill--info">{summary.monthlyDraftsReady} to review</span>
            )}
          </div>
          {summary.monthlyDraftsReady > 0 ? (
            <>
              <p className="muted small">
                We have prepared {summary.monthlyDraftsReady === 1 ? 'a draft' : 'drafts'} for you to check.
                Nothing has been sent to your customers.
              </p>
              <Link href="/bills?filter=monthly" className="btn btn--secondary btn--block">
                Review {summary.monthlyDraftsReady === 1 ? 'draft' : 'drafts'}
              </Link>
            </>
          ) : summary.activeScheduleCount > 0 ? (
            <p className="muted small">
              Nothing to review right now. We will prepare your next draft automatically.
            </p>
          ) : (
            <p className="muted small">
              Billing the same customer every month? Turn on “Repeat every month” on any bill and we will
              prepare the next one for you to review.
            </p>
          )}
        </section>

        {/* Money to collect */}
        <section className="card stack" aria-labelledby="collect-heading">
          <h2 id="collect-heading">Money to collect</h2>
          <Money paise={summary.moneyToCollectPaise} big />
          {summary.unpaidCount > 0 ? (
            <p className="muted small">
              Across {summary.unpaidCount} {summary.unpaidCount === 1 ? 'bill' : 'bills'}
              {summary.overdueCount > 0 && (
                <>
                  {' · '}
                  <span style={{ color: 'var(--danger)', fontWeight: 650 }}>
                    {summary.overdueCount} past the due date
                  </span>
                </>
              )}
            </p>
          ) : (
            <p className="muted small">Nothing outstanding. </p>
          )}
          {summary.unpaidCount > 0 && (
            <Link href="/bills?status=unpaid" className="btn btn--secondary btn--block">
              See unpaid bills
            </Link>
          )}
        </section>

        {/* GST returns -- shown only to businesses it applies to. */}
        {gst.visible && (
          <section className="card stack" aria-labelledby="gst-heading">
            <div className="row row--between">
              <h2 id="gst-heading">GST returns</h2>
              <span className="pill pill--info">{formatPeriodLong(monthPeriodOf(today))}</span>
            </div>
            <p className="muted small">{gst.homeCardLine}</p>
            <Link href="/gst" className="btn btn--secondary btn--block">
              Open GST returns
            </Link>
          </section>
        )}

        {summary.recentDrafts.length > 0 && (
          <section className="card card--flush deck__full" aria-labelledby="drafts-heading">
            <div className="card__header">
              <h2 id="drafts-heading">Your unfinished bills</h2>
            </div>
            <div className="list">
              {summary.recentDrafts.map((d) => (
                <Link key={d.id} href={`/bills/${d.id}`} className="list__item">
                  <span className="grow truncate">{d.customer.name}</span>
                  <Money paise={d.totals.grandTotalPaise} />
                  <span className="pill pill--draft">Draft</span>
                </Link>
              ))}
            </div>
          </section>
        )}
        </div>
      </main>
    </>
  );
}
