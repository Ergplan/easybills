'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { startDraftAction } from '@/app/actions/invoices';

/**
 * Quick bill or customer invoice.
 *
 * They are the SAME editor with different defaults -- the choice here only sets
 * whether the customer defaults to a walk-in and whether customer fields start
 * expanded. There is no second code path to keep in step.
 */
export function NewBillChooser({ businessName }: { businessName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(kind: 'quick-bill' | 'customer-invoice') {
    setBusy(kind);
    setError(null);
    const r = await startDraftAction(kind);
    if (r.ok) {
      router.replace(`/bills/${r.data.invoiceId}`);
    } else {
      setError(r.error);
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <button
        type="button"
        className="card stack"
        style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--line)', font: 'inherit', color: 'inherit' }}
        disabled={busy !== null}
        onClick={() => void start('quick-bill')}
      >
        <span className="strong" style={{ fontSize: '1.05rem' }}>Quick bill</span>
        <span className="muted small">
          For a walk-in customer. No customer details needed — just add items and issue.
        </span>
      </button>

      <button
        type="button"
        className="card stack"
        style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--line)', font: 'inherit', color: 'inherit' }}
        disabled={busy !== null}
        onClick={() => void start('customer-invoice')}
      >
        <span className="strong" style={{ fontSize: '1.05rem' }}>Customer invoice</span>
        <span className="muted small">
          For a customer you want to keep a record for, follow up, or bill every month.
        </span>
      </button>

      {busy && <p className="muted small" role="status">Opening your bill…</p>}
      {error && (
        <div className="notice notice--danger" role="alert">
          <span className="notice__icon" aria-hidden="true">!</span>
          <span>{error}</span>
        </div>
      )}
      <p className="tiny muted" style={{ textAlign: 'center' }}>Billing as {businessName}</p>
    </div>
  );
}
