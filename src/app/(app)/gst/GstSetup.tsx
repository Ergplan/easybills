'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { addMonthsToPeriod, monthPeriodOf, todayIst } from '@/lib/dates';
import type { FilingFrequency } from '@/lib/domain/types';
import { setupGstReturnsAction } from '@/app/actions/gst';

/**
 * One-time GST return setup.
 *
 * Everything here is CONFIRMED by the owner. We do not infer filing frequency
 * from turnover, we do not enrol anyone in QRMP, and we ask which periods were
 * already filed elsewhere so this app never claims responsibility for them.
 */
export function GstSetup({ businessId, suggestedGstin }: { businessId: string; suggestedGstin: string }) {
  const router = useRouter();
  const [gstin, setGstin] = useState(suggestedGstin);
  const [frequency, setFrequency] = useState<FilingFrequency>('monthly');
  const [usesIff, setUsesIff] = useState(false);
  const [startPeriod, setStartPeriod] = useState(addMonthsToPeriod(monthPeriodOf(todayIst()), -1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="stack">
      <div className="card stack">
        <h2>Set up GST returns</h2>
        <p className="muted small">
          We need a few details, once. These come from your GST registration — please check them on the GST portal
          or with your accountant rather than guessing.
        </p>

        <div className="field">
          <label className="field__label" htmlFor="g-gstin">Your GST number</label>
          <input
            id="g-gstin"
            className="input"
            maxLength={15}
            style={{ textTransform: 'uppercase' }}
            value={gstin}
            onChange={(e) => setGstin(e.target.value.toUpperCase())}
          />
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field__label" style={{ padding: 0 }}>How often do you file?</legend>
          <p className="field__hint" style={{ marginBottom: 4 }}>
            This is set on your GST registration. It is not decided by how small your business is.
          </p>
          <label className="checkbox-row">
            <input type="radio" name="freq" checked={frequency === 'monthly'} onChange={() => setFrequency('monthly')} />
            <span className="stack" style={{ gap: 2 }}>
              <span className="strong">Every month</span>
              <span className="tiny muted">You file GSTR-1 and GSTR-3B monthly.</span>
            </span>
          </label>
          <label className="checkbox-row">
            <input type="radio" name="freq" checked={frequency === 'quarterly-qrmp'} onChange={() => setFrequency('quarterly-qrmp')} />
            <span className="stack" style={{ gap: 2 }}>
              <span className="strong">Every three months (QRMP)</span>
              <span className="tiny muted">You file quarterly, but still pay tax in the first two months.</span>
            </span>
          </label>
        </fieldset>

        {frequency === 'quarterly-qrmp' && (
          <label className="checkbox-row">
            <input type="checkbox" checked={usesIff} onChange={(e) => setUsesIff(e.target.checked)} />
            <span className="stack" style={{ gap: 2 }}>
              <span className="small strong">I upload my business-to-business bills in the first two months</span>
              <span className="tiny muted">
                This is the Invoice Furnishing Facility. If you use it, we will not report those bills again in the
                quarterly return.
              </span>
            </span>
          </label>
        )}

        <div className="field">
          <label className="field__label" htmlFor="g-start">First period you want us to help with</label>
          <input id="g-start" className="input" type="month" value={startPeriod} onChange={(e) => setStartPeriod(e.target.value)} />
          <span className="field__hint">Earlier periods stay with whoever handled them before.</span>
        </div>

        {error && <p className="field__error" role="alert">{error}</p>}

        <button
          type="button"
          className="btn btn--primary btn--block btn--large"
          disabled={busy || gstin.length !== 15}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const r = await setupGstReturnsAction(businessId, {
              gstin,
              filingFrequency: frequency,
              usesIff,
              filingStartPeriod: startPeriod,
              previouslyFiledPeriods: [],
            });
            setBusy(false);
            if (r.ok) router.refresh();
            else setError(r.error);
          }}
        >
          {busy ? 'Saving…' : 'Save and continue'}
        </button>
      </div>

      <div className="notice notice--info">
        <span className="notice__icon" aria-hidden="true">i</span>
        <span className="small">
          This app helps you PREPARE your returns and check them. Preparing is not filing — we will always tell you
          which stage you are at.
        </span>
      </div>
    </div>
  );
}
