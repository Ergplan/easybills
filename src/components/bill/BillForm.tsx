'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { makeBillAction } from '@/app/actions/invoices';
import { Money } from '@/components/Money';
import { t } from '@/lib/copy';
import { moneyForMessage } from '@/lib/copy/messages';
import { formatDateShort, type CivilDate } from '@/lib/dates';
import {
  blankLine,
  checkBill,
  linesToDraft,
  subtotalOf,
  type BillDraft,
  type BillProblem,
  type LineDraft,
} from '@/lib/domain/bill-form';
import type { InvoiceLine } from '@/lib/domain/types';

export interface LastTime {
  /** "Aug" -- the month of the last bill, for the offer. */
  month: string;
  summary: string;
  amountPaise: number;
  lines: InvoiceLine[];
}

export interface BillFormProps {
  businessId: string;
  invoiceId: string;
  baseRevision: number;
  issueDate: CivilDate;
  customer: { customerId: string | null; name: string; phone: string | null };
  /** Whether the business charges GST: decides if the rate is asked at all. */
  chargesGst: boolean;
  gstRatesBp: number[];
  defaultGstRateBp: number | null;
  lastTime: LastTime | null;
  /** Things that stop a bill going out, from the profile. English from the engine for now. */
  blockers: Array<{ message: string; whatYouCanDo: string }>;
}

let counter = 0;
const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `line-${Date.now()}-${counter++}`);

/**
 * The bill, in three fields per line.
 *
 * Kya kiya? Kitna. Rate. The total updates as the owner types, "Bill banao"
 * makes it, and the next screen is the bill with a WhatsApp button. No
 * autosave, no review step: the whole thing is one screen and one tap, the
 * way it was on paper.
 */
export function BillForm(props: BillFormProps) {
  const router = useRouter();
  const isNewCustomer = !props.customer.customerId;
  const [draft, setDraft] = useState<BillDraft>({
    customerName: props.customer.name,
    customerPhone: props.customer.phone ?? '',
    customerGstin: '',
    lines: [blankLine(newId())],
    gstRateBp: props.chargesGst ? props.defaultGstRateBp : null,
  });
  const [problem, setProblem] = useState<{ problem: BillProblem; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offerLastTime, setOfferLastTime] = useState(Boolean(props.lastTime));

  const setLine = (id: string, patch: Partial<LineDraft>) => {
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
    setProblem(null);
  };

  const subtotal = subtotalOf(draft.lines);
  const gst = props.chargesGst && draft.gstRateBp ? Math.round((subtotal * draft.gstRateBp) / 10000) : 0;

  async function make() {
    const checked = checkBill(draft, { needsCustomerName: isNewCustomer, chargesGst: props.chargesGst });
    if (!checked.ok) {
      setProblem({ problem: checked.problem, message: checked.message });
      return;
    }
    setBusy(true);
    setError(null);
    const r = await makeBillAction(props.businessId, {
      invoiceId: props.invoiceId,
      baseRevision: props.baseRevision,
      issueDate: props.issueDate,
      customer: {
        customerId: props.customer.customerId,
        name: draft.customerName,
        phone: draft.customerPhone || null,
        gstin: draft.customerGstin || null,
      },
      lines: checked.lines,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.blockers?.length ? `${r.error} ${r.blockers.map((b) => b.whatYouCanDo).join(' ')}` : r.error);
      return;
    }
    // Stays busy: the done screen is the next route, not a state of this one.
    setBusy(true);
    router.replace(`/bills/${r.data.invoice.id}?done=1`);
  }

  const lineProblem = (id: string, field: 'what' | 'qty' | 'rate') =>
    problem && 'lineId' in problem.problem && problem.problem.lineId === id && problem.problem.field === field
      ? problem.message
      : null;

  return (
    <div className="stack">
      {props.blockers.length > 0 && (
        <div className="notice notice--warn">
          <span className="notice__icon" aria-hidden="true">!</span>
          <div className="stack" style={{ gap: 4 }}>
            <strong>{t('bill.cannotYet')}</strong>
            {props.blockers.map((b, i) => (
              <span key={i} className="small">{b.message} {b.whatYouCanDo}</span>
            ))}
          </div>
        </div>
      )}

      {offerLastTime && props.lastTime && (
        <div className="card card--offer">
          <div className="row">
            <div className="grow">
              <strong>{t('bill.same.title')}</strong>
              <div className="faint">
                {t('bill.same.sub', {
                  month: props.lastTime.month,
                  summary: props.lastTime.summary,
                  amount: moneyForMessage(props.lastTime.amountPaise),
                })}
              </div>
            </div>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => {
                setDraft((d) => ({ ...d, lines: linesToDraft(props.lastTime!.lines, newId) }));
                setOfferLastTime(false);
              }}
            >
              {t('bill.same.yes')}
            </button>
          </div>
        </div>
      )}

      {isNewCustomer && (
        <section className="card stack">
          <div className="field">
            <label className="field__label" htmlFor="bill-customer">{t('bill.customer.name')}</label>
            <input
              id="bill-customer"
              className="input"
              value={draft.customerName}
              autoFocus
              onChange={(e) => {
                setDraft((d) => ({ ...d, customerName: e.target.value }));
                setProblem(null);
              }}
              maxLength={200}
            />
            {problem?.problem.field === 'customerName' ? (
              <span className="field__error" role="alert">{problem.message}</span>
            ) : (
              <span className="field__hint">{t('bill.customer.nameHint')}</span>
            )}
          </div>
          <div className="field">
            <label className="field__label" htmlFor="bill-phone">{t('customer.phone')} · {t('common.optional')}</label>
            <input
              id="bill-phone"
              className="input"
              type="tel"
              inputMode="numeric"
              value={draft.customerPhone}
              onChange={(e) => setDraft((d) => ({ ...d, customerPhone: e.target.value }))}
              maxLength={16}
            />
          </div>
          {props.chargesGst && (
            <div className="field">
              <label className="field__label" htmlFor="bill-gstin">{t('customer.gstin')}</label>
              <input
                id="bill-gstin"
                className="input"
                value={draft.customerGstin}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, customerGstin: e.target.value.toUpperCase() }));
                  setError(null);
                }}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={15}
                placeholder="27ABCDE1234F1Z5"
              />
              <span className="field__hint">{t('customer.gstinHint')}</span>
            </div>
          )}
        </section>
      )}

      <section className="card stack" aria-label={t('bill.item.label')}>
        {draft.lines.map((line, i) => (
          <div key={line.id} className="bill-line">
            <div className="field">
              <label className="field__label" htmlFor={`what-${line.id}`}>{t('bill.item.label')}</label>
              <input
                id={`what-${line.id}`}
                className="input"
                value={line.what}
                placeholder={i === 0 ? t('bill.item.placeholder') : undefined}
                autoFocus={!isNewCustomer && i === 0 && !offerLastTime}
                onChange={(e) => setLine(line.id, { what: e.target.value })}
                maxLength={300}
              />
              {lineProblem(line.id, 'what') && <span className="field__error" role="alert">{lineProblem(line.id, 'what')}</span>}
            </div>
            <div className="bill-line__nums">
              <div className="field">
                <label className="field__label" htmlFor={`qty-${line.id}`}>{t('bill.qty')}</label>
                <input
                  id={`qty-${line.id}`}
                  className="input input--numeric"
                  inputMode="decimal"
                  value={line.qty}
                  onChange={(e) => setLine(line.id, { qty: e.target.value })}
                  maxLength={10}
                />
                {lineProblem(line.id, 'qty') && <span className="field__error" role="alert">{lineProblem(line.id, 'qty')}</span>}
              </div>
              <div className="field">
                <label className="field__label" htmlFor={`rate-${line.id}`}>{t('bill.rate')}</label>
                <input
                  id={`rate-${line.id}`}
                  className="input input--numeric"
                  inputMode="decimal"
                  value={line.rate}
                  onChange={(e) => setLine(line.id, { rate: e.target.value })}
                  maxLength={14}
                />
                {lineProblem(line.id, 'rate') && <span className="field__error" role="alert">{lineProblem(line.id, 'rate')}</span>}
              </div>
              {draft.lines.length > 1 && (
                <button
                  type="button"
                  className="btn btn--ghost bill-line__remove"
                  aria-label={t('bill.line.remove')}
                  onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((l) => l.id !== line.id) }))}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        ))}
        {problem?.problem.field === 'lines' && <span className="field__error" role="alert">{problem.message}</span>}
        <button
          type="button"
          className="btn btn--ghost"
          style={{ alignSelf: 'flex-start', paddingInline: 4 }}
          onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, blankLine(newId())] }))}
        >
          {t('bill.addItem')}
        </button>
      </section>

      {props.chargesGst && (
        <section className="card">
          <div className="field">
            <label className="field__label" htmlFor="bill-gst">{t('bill.gstRate')}</label>
            <select
              id="bill-gst"
              className="select"
              value={draft.gstRateBp ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, gstRateBp: e.target.value === '' ? null : Number(e.target.value) }))}
            >
              <option value="">—</option>
              {props.gstRatesBp.map((bp) => (
                <option key={bp} value={bp}>{bp / 100}%</option>
              ))}
            </select>
            <span className="field__hint">{t('bill.gstRateHint')}</span>
          </div>
        </section>
      )}

      <section className="card stack stack--tight">
        {props.chargesGst && (
          <>
            <div className="row row--between small muted">
              <span>{t('bill.subtotal')}</span>
              <Money paise={subtotal} />
            </div>
            <div className="row row--between small muted">
              <span>{t('bill.gst', { rate: (draft.gstRateBp ?? 0) / 100 })}</span>
              <Money paise={gst} />
            </div>
          </>
        )}
        <div className="row row--between">
          <span className="strong">{t('bill.total')}</span>
          <span className="bill-total"><Money paise={subtotal + gst} whole /></span>
        </div>
        <div className="faint">{t('bill.date')}: {formatDateShort(props.issueDate)}</div>
      </section>

      {error && (
        <div className="notice notice--danger" role="alert">
          <span className="notice__icon" aria-hidden="true">!</span>
          <span>{error}</span>
        </div>
      )}

      <div className="stack stack--tight">
        <button
          type="button"
          className="btn btn--primary btn--block btn--large"
          disabled={busy || props.blockers.length > 0}
          onClick={() => void make()}
        >
          {busy ? <span className="spinner" aria-hidden="true" /> : null}
          {t('bill.make')}
        </button>
        <p className="faint" style={{ textAlign: 'center' }}>{t('bill.makeNote')}</p>
      </div>
    </div>
  );
}
