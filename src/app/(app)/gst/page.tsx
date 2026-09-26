import Link from 'next/link';
import { redirect } from 'next/navigation';

import { t } from '@/lib/copy';
import { addMonthsToPeriod, formatDateShort, isMonthPeriod, monthPeriodOf, todayIst, type MonthPeriod } from '@/lib/dates';
import { gstTabVisible } from '@/lib/domain/gst-tab';
import { moneyWhole, quarterBounds, summariseQuarter } from '@/lib/domain/gst-summary';
import { requireCurrentContext } from '@/server/auth/current';
import { listInvoices, listIssuedBetween } from '@/server/repos/invoices';

import { GstSend } from './GstSend';

export const dynamic = 'force-dynamic';

/**
 * GST ka hisaab. One screen, for the owner who is registered: this
 * quarter's bills, sales and GST, split by rate, the company bills the CA
 * reports one by one, and a button that hands the whole thing to the CA.
 * Not returns. Not filing. The CA files.
 */
export default async function GstPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const { business } = await requireCurrentContext();
  if (!gstTabVisible(business)) redirect('/home');

  const month: MonthPeriod = q && isMonthPeriod(q) ? q : monthPeriodOf(todayIst());
  const { from, to, months } = quarterBounds(month);
  const issued = await listIssuedBetween(business.id, from, to);
  const cancelled = (await listInvoices(business.id, { status: 'cancelled', limit: 100 })).filter((c) => c.issueDate >= from && c.issueDate <= to && c.number);
  const s = summariseQuarter(issued, month);
  const prev = addMonthsToPeriod(months[0]!, -3);
  const next = addMonthsToPeriod(months[0]!, 3);
  const b2bBills = s.b2b.reduce((n, r) => n + r.bills, 0);

  return (
    <main className="page">
      <div className="stack" style={{ gap: 4, paddingTop: 8 }}>
        <h1>{t('gst.title')}</h1>
        <p className="muted">{t('gst.period', { from: formatDateShort(from).replace(/ \d{4}$/, ''), to: formatDateShort(to) })}</p>
      </div>

      <div className="row row--between">
        <Link href={`/gst?q=${prev}`} className="btn btn--ghost">‹ {t('gst.prev')}</Link>
        {next <= monthPeriodOf(todayIst()) && <Link href={`/gst?q=${next}`} className="btn btn--ghost">{t('gst.next')} ›</Link>}
      </div>

      <section className="card stack stack--tight">
        <p className="card__sub" style={{ marginTop: 0 }}>{t('gst.thisQuarter')} · {s.label}</p>
        <div className="gst-figures">
          <div><div className="faint">{t('gst.bills')}</div><div className="gst-figure">{s.bills}</div></div>
          <div><div className="faint">{t('gst.sales')}</div><div className="gst-figure">{moneyWhole(s.salesPaise)}</div></div>
          <div><div className="faint">{t('gst.tax')}</div><div className="gst-figure">{moneyWhole(s.taxPaise)}</div></div>
        </div>
        {s.bills === 0 ? (
          <p className="muted">{t('gst.empty')}</p>
        ) : (
          <div className="table-scroll">
            <table className="gst-table">
              <thead>
                <tr>
                  <th>{t('gst.rate')}</th>
                  <th className="num">{t('gst.taxable')}</th>
                  <th className="num">CGST</th>
                  <th className="num">SGST</th>
                  {s.byRate.some((r) => r.igstPaise > 0) && <th className="num">IGST</th>}
                </tr>
              </thead>
              <tbody>
                {s.byRate.map((r) => (
                  <tr key={r.rateBp}>
                    <td>{r.rateBp / 100}%</td>
                    <td className="num">{moneyWhole(r.taxablePaise).slice(1)}</td>
                    <td className="num">{moneyWhole(r.cgstPaise).slice(1)}</td>
                    <td className="num">{moneyWhole(r.sgstPaise).slice(1)}</td>
                    {s.byRate.some((x) => x.igstPaise > 0) && <td className="num">{moneyWhole(r.igstPaise).slice(1)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {s.b2b.length > 0 && (
        <section className="card stack stack--tight">
          <div>
            <h2 className="card__title" style={{ fontSize: '1.1rem' }}>{t('gst.b2b.title')}</h2>
            <p className="card__sub">{t('gst.b2b.sub', { n: b2bBills })}</p>
          </div>
          <div className="rows">
            {s.b2b.map((r) => (
              <div key={r.gstin} className="row-line">
                <div className="row-line__link">
                  <div className="row-line__name">{r.name}</div>
                  <div className="row-line__meta">{r.gstin} · {r.bills} {r.bills === 1 ? 'bill' : 'bills'}</div>
                </div>
                <span className="amount">{moneyWhole(r.totalPaise)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {s.bills > 0 && s.b2cBills > 0 && <p className="faint">{t('gst.b2c.note', { n: s.b2cBills })}</p>}
      {cancelled.length > 0 && <p className="faint">{t('gst.cancelled', { n: cancelled.length, numbers: cancelled.map((c) => c.number).join(', ') })}</p>}

      {s.bills > 0 && <GstSend businessId={business.id} month={month} label={s.label} />}
      <p className="faint" style={{ textAlign: 'center' }}>{t('gst.notFiled')}</p>
    </main>
  );
}
