'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { likhLoAction } from '@/app/actions/invoices';
import { Money } from '@/components/Money';
import { t } from '@/lib/copy';
import { moneyForMessage } from '@/lib/copy/messages';
import { formatDateShort, todayIst, type CivilDate } from '@/lib/dates';
import { formatQuantityPlain } from '@/lib/money';
import type { InvoiceRecord, PaymentRecord } from '@/lib/domain/types';

type How = 'upi' | 'cash' | 'bank-transfer' | 'other';
const HOWS: Array<{ key: How; label: 'paid.how.upi' | 'paid.how.cash' | 'paid.how.bank' | 'paid.how.other' }> = [
  { key: 'upi', label: 'paid.how.upi' },
  { key: 'cash', label: 'paid.how.cash' },
  { key: 'bank-transfer', label: 'paid.how.bank' },
  { key: 'other', label: 'paid.how.other' },
];

/**
 * A bill that has gone out. What is still to come, and the two things the
 * owner does about it: remind, or write down that the money came.
 *
 * The document itself cannot change here. Corrections, reversals and
 * duplicates are gone from this screen; for fifty bills a year they were
 * buttons in the way of the one that matters.
 */
export function BillView({
  businessId,
  invoice,
  payments,
  today,
}: {
  businessId: string;
  invoice: InvoiceRecord;
  payments: PaymentRecord[];
  today: CivilDate;
}) {
  const router = useRouter();
  const due = invoice.balancePaise > 0;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'full' | 'part'>('full');
  const [amount, setAmount] = useState('');
  const [when, setWhen] = useState(today);
  const [how, setHow] = useState<How>('upi');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [nonce, setNonce] = useState(() => crypto.randomUUID());
  const pdfUrl = `/api/invoices/${invoice.id}/pdf?b=${encodeURIComponent(businessId)}`;

  async function likhLo() {
    setBusy(true);
    setError(null);
    const value = mode === 'full' ? (invoice.balancePaise / 100).toString() : amount;
    const r = await likhLoAction(businessId, {
      invoiceId: invoice.id,
      amount: value,
      receivedOn: when,
      method: how,
      idempotencyKey: [nonce, value, when, how].join('|'),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setNonce(crypto.randomUUID());
    setSaved(true);
    setOpen(false);
    setAmount('');
    router.refresh();
  }

  const status = !due ? 'paid' : invoice.amountPaidPaise > 0 || invoice.creditAppliedPaise > 0 ? 'partly' : 'sent';

  return (
    <div className="stack">
      <section className="card stack stack--tight">
        <div className="row row--between">
          <span className="faint">{t('bill.view.sentOn', { date: formatDateShort(invoice.issueDate) })}</span>
          <span className={`pill ${status === 'paid' ? 'pill--paid' : status === 'partly' ? 'pill--partly' : 'pill--sent'}`}>
            {t(status === 'paid' ? 'status.paid' : status === 'partly' ? 'status.partly' : 'status.sent')}
          </span>
        </div>
        <div className="home__big amount">
          <Money paise={due ? invoice.balancePaise : invoice.totals.grandTotalPaise} whole />
        </div>
        <p className="card__sub">
          {due
            ? invoice.amountPaidPaise > 0
              ? t('paid.remaining', { amount: moneyForMessage(invoice.balancePaise) })
              : t('bill.total') + ' ' + moneyForMessage(invoice.totals.grandTotalPaise)
            : t('paid.allDone')}
        </p>
        {saved && (
          <div className="notice notice--ok" role="status">
            <span className="notice__icon" aria-hidden="true">✓</span>
            <span>{t('paid.saved')}</span>
          </div>
        )}
        {due && !open && (
          <div className="row row--tight" style={{ marginTop: 6 }}>
            <Link href={`/bills/${invoice.id}/remind`} className="btn btn--secondary grow">
              {t('remind.button')}
            </Link>
            <button type="button" className="btn btn--primary grow" onClick={() => setOpen(true)}>
              {t('paid.button')}
            </button>
          </div>
        )}
        {due && open && (
          <div className="stack" style={{ paddingTop: 8, borderTop: '1px solid var(--line)' }}>
            <h2 className="card__title" style={{ fontSize: '1.15rem' }}>{t('paid.title')}</h2>
            <div className="chips">
              <button type="button" className="chip" aria-pressed={mode === 'full'} onClick={() => setMode('full')}>
                <span className="chip__name">{t('paid.full', { amount: moneyForMessage(invoice.balancePaise) })}</span>
              </button>
              <button type="button" className="chip" aria-pressed={mode === 'part'} onClick={() => setMode('part')}>
                <span className="chip__name">{t('paid.partial')}</span>
              </button>
            </div>
            {mode === 'part' && (
              <div className="field">
                <label className="field__label" htmlFor="paid-amount">{t('paid.amount')}</label>
                <input
                  id="paid-amount"
                  className="input input--numeric"
                  inputMode="decimal"
                  value={amount}
                  autoFocus
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setError(null);
                  }}
                />
              </div>
            )}
            <div className="you-place">
              <div className="field">
                <label className="field__label" htmlFor="paid-when">{t('paid.date')}</label>
                <input id="paid-when" className="input" type="date" value={when} max={todayIst()} onChange={(e) => setWhen(e.target.value)} />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="paid-how">{t('paid.how')}</label>
                <select id="paid-how" className="select" value={how} onChange={(e) => setHow(e.target.value as How)}>
                  {HOWS.map((h) => (
                    <option key={h.key} value={h.key}>{t(h.label)}</option>
                  ))}
                </select>
              </div>
            </div>
            {error && <span className="field__error" role="alert">{error}</span>}
            <div className="row row--tight">
              <button
                type="button"
                className="btn btn--primary grow"
                disabled={busy || (mode === 'part' && !amount.trim())}
                onClick={() => void likhLo()}
              >
                {busy ? <span className="spinner" aria-hidden="true" /> : null}
                {t('paid.save')}
              </button>
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </section>

      {payments.length > 0 && (
        <section className="card stack stack--tight">
          <h2 className="card__title" style={{ fontSize: '1.1rem' }}>{t('paid.list')}</h2>
          <div className="rows">
            {payments.map((p) => (
              <div key={p.id} className="row-line">
                <div className="row-line__link">
                  <div className="row-line__name">{formatDateShort(p.receivedOn)}</div>
                  <div className="row-line__meta">{t(HOWS.find((h) => h.key === p.method)?.label ?? 'paid.how.other')}</div>
                </div>
                <Money paise={p.allocations.find((a) => a.invoiceId === invoice.id)?.amountPaise ?? p.amountPaise} whole />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card stack stack--tight">
        <h2 className="card__title" style={{ fontSize: '1.1rem' }}>{t('bill.view.items')}</h2>
        <div className="rows">
          {invoice.lines.map((l) => (
            <div key={l.id} className="row-line">
              <div className="row-line__link">
                <div className="row-line__name">{l.description}</div>
                <div className="row-line__meta">
                  {formatQuantityPlain(l.quantityMilli)} × <Money paise={l.unitPricePaise} whole />
                </div>
              </div>
              <Money paise={Math.round((l.quantityMilli * l.unitPricePaise) / 1000) - l.discountPaise} whole />
            </div>
          ))}
          {invoice.totals.totalTaxPaise > 0 && (
            <div className="row-line">
              <div className="row-line__link"><div className="row-line__meta">GST</div></div>
              <Money paise={invoice.totals.totalTaxPaise} whole />
            </div>
          )}
          <div className="row-line">
            <div className="row-line__link"><div className="row-line__name">{t('bill.total')}</div></div>
            <span className="bill-total"><Money paise={invoice.totals.grandTotalPaise} whole /></span>
          </div>
        </div>
      </section>

      <div className="row row--tight">
        <a className="btn btn--secondary grow" href={`${pdfUrl}&download=1`}>{t('bill.done.pdf')}</a>
        <Link className="btn btn--secondary grow" href={`/bills/${invoice.id}?done=1`}>{t('bill.view.share')}</Link>
      </div>
    </div>
  );
}
