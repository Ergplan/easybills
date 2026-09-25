'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { addMonths, formatDateShort, monthPeriodOf, partsOf } from '@/lib/dates';
import type { BillingPeriodChoice, RecurringScheduleRecord } from '@/lib/domain/types';
import { billingPeriodExample } from '@/server/services/recurrence';
import {
  pauseScheduleAction,
  resumeScheduleAction,
  skipNextOccurrenceAction,
  startMonthlyScheduleAction,
  stopScheduleAction,
} from '@/app/actions/schedules';

/**
 * "Repeat every month".
 *
 * The supporting text is the promise in full: *we will prepare a draft for you
 * to review*. Nothing is issued, nothing is sent, and no payment is collected.
 *
 * The billing-period choice is never left abstract — a worked example is shown
 * for whichever option is selected, using the owner's own chosen date.
 */
export function RepeatMonthly({
  businessId,
  invoiceId,
  issueDate,
  hasCustomer,
  existing,
}: {
  businessId: string;
  invoiceId: string;
  issueDate: string;
  hasCustomer: boolean;
  existing: RecurringScheduleRecord | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const anchorDay = partsOf(issueDate).day;
  const [startDate, setStartDate] = useState(addMonths(issueDate, 1, anchorDay));
  const [endDate, setEndDate] = useState('');
  const [choice, setChoice] = useState<BillingPeriodChoice>('previous-month');

  // ---------------------------------------------------------- existing
  if (existing) {
    const stopped = existing.status === 'stopped' || existing.status === 'completed';
    return (
      <section className="card stack" aria-labelledby="repeat-heading">
        <div className="row row--between">
          <h2 id="repeat-heading">Repeat every month</h2>
          <span className={`pill ${existing.status === 'active' ? 'pill--paid' : 'pill--draft'}`}>
            {existing.status === 'active' ? 'On' : existing.status === 'paused' ? 'Paused' : 'Stopped'}
          </span>
        </div>

        {existing.nextDraftDate && !stopped ? (
          <p className="muted small">
            Next draft {formatDateShort(existing.nextDraftDate)}. We will prepare it for you to review — nothing is
            sent to {existing.customerName}.
          </p>
        ) : (
          <p className="muted small">No more drafts will be prepared.</p>
        )}

        {existing.skippedPeriods.length > 0 && (
          <p className="tiny muted">
            Skipped: {existing.skippedPeriods.join(', ')}. Skipped months are not prepared again.
          </p>
        )}

        {note && (
          <div className="notice notice--ok" role="status">
            <span className="notice__icon" aria-hidden="true">✓</span>
            <span className="small">{note}</span>
          </div>
        )}
        {error && (
          <div className="notice notice--danger" role="alert">
            <span className="notice__icon" aria-hidden="true">!</span>
            <span className="small">{error}</span>
          </div>
        )}

        {!stopped && (
          <div className="row row--tight">
            {existing.status === 'active' ? (
              <>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const r = await pauseScheduleAction(businessId, existing.id);
                    setBusy(false);
                    if (r.ok) { setNote('Paused. No drafts will be prepared until you resume.'); router.refresh(); }
                    else setError(r.error);
                  }}
                >
                  Pause
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={busy || !existing.nextDraftDate}
                  onClick={async () => {
                    if (!existing.nextDraftDate) return;
                    const period = monthPeriodOf(existing.nextDraftDate);
                    if (!window.confirm(`Skip ${period}? We will not prepare a draft for that month, and skipping it is permanent.`)) return;
                    setBusy(true);
                    const r = await skipNextOccurrenceAction(businessId, existing.id, period);
                    setBusy(false);
                    if (r.ok) { setNote(`${period} will be skipped.`); router.refresh(); }
                    else setError(r.error);
                  }}
                >
                  Skip next month
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await resumeScheduleAction(businessId, existing.id);
                  setBusy(false);
                  if (r.ok) { setNote(`Resumed. Next draft ${formatDateShort(r.data.nextDraftDate)}.`); router.refresh(); }
                  else setError(r.error);
                }}
              >
                Resume
              </button>
            )}

            <button
              type="button"
              className="btn btn--danger"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm('Stop this monthly bill for good? Bills already created are unaffected.')) return;
                setBusy(true);
                const r = await stopScheduleAction(businessId, existing.id);
                setBusy(false);
                if (r.ok) { setNote('Stopped.'); router.refresh(); }
                else setError(r.error);
              }}
            >
              Stop
            </button>
          </div>
        )}
      </section>
    );
  }

  // ------------------------------------------------------------- set up
  if (!open) {
    return (
      <button type="button" className="btn btn--secondary btn--block" onClick={() => setOpen(true)}>
        Repeat every month
      </button>
    );
  }

  return (
    <section className="card stack" aria-labelledby="repeat-setup">
      <h2 id="repeat-setup">Repeat every month</h2>
      <p className="muted small">We will prepare a draft for you to review. Nothing is sent to your customer.</p>

      {!hasCustomer && (
        <div className="notice notice--warn">
          <span className="notice__icon" aria-hidden="true">!</span>
          <span className="small">
            A monthly bill needs a saved customer, so we know who to prepare it for. This bill does not have one.
          </span>
        </div>
      )}

      <div className="field">
        <label className="field__label" htmlFor="next-draft">Prepare the next draft on</label>
        <input id="next-draft" className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <span className="field__hint">
          Choosing the {anchorDay}
          {anchorDay === 31 ? 'st means short months use their last day, then it goes back to the 31st.' : 'th of each month.'}
        </span>
      </div>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field__label" style={{ padding: 0 }}>What does each bill cover?</legend>
        <label className="checkbox-row">
          <input type="radio" name="period" checked={choice === 'previous-month'} onChange={() => setChoice('previous-month')} />
          <span className="small">The month before</span>
        </label>
        <label className="checkbox-row">
          <input type="radio" name="period" checked={choice === 'current-month'} onChange={() => setChoice('current-month')} />
          <span className="small">The month it is prepared in</span>
        </label>
        <p className="field__hint">{billingPeriodExample(startDate, choice)}</p>
      </fieldset>

      <details className="disclosure">
        <summary>Stop after a date</summary>
        <div className="disclosure__body field">
          <label className="field__label" htmlFor="end-date">Last draft on or before</label>
          <input id="end-date" className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </details>

      {error && (
        <div className="notice notice--danger" role="alert">
          <span className="notice__icon" aria-hidden="true">!</span>
          <span className="small">{error}</span>
        </div>
      )}

      <div className="row row--tight">
        <button
          type="button"
          className="btn btn--primary grow"
          disabled={busy || !hasCustomer}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const r = await startMonthlyScheduleAction(businessId, {
              sourceInvoiceId: invoiceId,
              anchorDay: partsOf(startDate).day,
              startDate,
              endDate: endDate || null,
              billingPeriodChoice: choice,
            });
            setBusy(false);
            if (r.ok) { setOpen(false); router.refresh(); }
            else setError(r.error);
          }}
        >
          {busy ? 'Setting up…' : 'Turn on monthly bills'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </section>
  );
}
