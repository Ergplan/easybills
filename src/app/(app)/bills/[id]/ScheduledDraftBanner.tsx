'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { formatDateShort, formatPeriodLong, monthPeriodOf } from '@/lib/dates';
import { applyToFutureInvoicesAction } from '@/app/actions/schedules';

/**
 * Shown on a draft that the monthly worker prepared.
 *
 * Two things it makes unmissable: which supply period this bill covers (which is
 * NOT its date), and that an edit applies to **this invoice only** unless the
 * owner deliberately chooses otherwise. Choosing otherwise shows what will
 * change, and from which month, before anything is committed.
 */
export function ScheduledDraftBanner({
  businessId,
  invoiceId,
  scheduleId,
  billingPeriod,
  issueDate,
}: {
  businessId: string;
  invoiceId: string;
  scheduleId: string;
  billingPeriod: { from: string; to: string } | null;
  issueDate: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ changedFields: string[]; effectiveFromPeriod: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="notice notice--info" aria-label="Monthly draft">
      <span className="notice__icon" aria-hidden="true">🗓</span>
      <div className="stack" style={{ gap: 8 }}>
        <span className="small strong">We prepared this for you to review.</span>
        {billingPeriod && (
          <span className="tiny">
            It covers {formatDateShort(billingPeriod.from)} to {formatDateShort(billingPeriod.to)}, and is dated{' '}
            {formatDateShort(issueDate)}.
          </span>
        )}
        <span className="tiny">
          Any change you make here applies to <strong>this bill only</strong>.
        </span>

        {result ? (
          <span className="tiny strong">
            {result.changedFields.length
              ? `Future bills from ${formatPeriodLong(result.effectiveFromPeriod)} will use the new ${result.changedFields.join(', ')}.`
              : 'Nothing was different, so future bills are unchanged.'}
          </span>
        ) : (
          <button
            type="button"
            className="btn btn--secondary"
            style={{ alignSelf: 'flex-start' }}
            disabled={busy}
            onClick={async () => {
              const period = formatPeriodLong(monthPeriodOf(issueDate));
              if (
                !window.confirm(
                  `Use this bill's items and terms for this and every future month, starting ${period}?\n\n` +
                    'Bills already prepared for earlier months are not changed.',
                )
              ) {
                return;
              }
              setBusy(true);
              setError(null);
              const r = await applyToFutureInvoicesAction(businessId, { scheduleId, fromInvoiceId: invoiceId });
              setBusy(false);
              if (r.ok) {
                setResult(r.data);
                router.refresh();
              } else setError(r.error);
            }}
          >
            Apply to this and future months
          </button>
        )}

        {error && <span className="tiny" style={{ color: 'var(--danger)' }}>{error}</span>}
      </div>
    </section>
  );
}
