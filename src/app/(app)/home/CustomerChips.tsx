'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { startBillForCustomerAction } from '@/app/actions/invoices';
import { t } from '@/lib/copy';
import { initialOf } from '@/lib/domain/home';

interface Chip {
  id: string;
  name: string;
}

/**
 * The customer list, as the first card's buttons. Tap a name and a bill for
 * them opens with their details already on it; "Naya customer" opens one
 * with the name left for the owner to type.
 */
export function CustomerChips({ customers }: { customers: Chip[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(customerId: string | null) {
    setBusy(customerId ?? 'new');
    setError(null);
    const r = await startBillForCustomerAction(customerId);
    if (r.ok) {
      router.push(`/bills/${r.data.invoiceId}`);
      return;
    }
    setError(r.error);
    setBusy(null);
  }

  return (
    <div className="stack stack--tight">
      <div className="chips">
        {customers.map((c) => (
          <button
            key={c.id}
            type="button"
            className="chip"
            disabled={busy !== null}
            aria-busy={busy === c.id}
            onClick={() => void start(c.id)}
          >
            <span className="chip__initial" aria-hidden="true">{initialOf(c.name)}</span>
            <span className="chip__name">{c.name}</span>
          </button>
        ))}
        <button
          type="button"
          className="chip chip--new"
          disabled={busy !== null}
          aria-busy={busy === 'new'}
          onClick={() => void start(null)}
        >
          <span className="chip__initial" aria-hidden="true">+</span>
          <span className="chip__name">{t('home.bill.newCustomer')}</span>
        </button>
      </div>
      {busy && <p className="faint" role="status">{t('common.loading')}</p>}
      {error && (
        <div className="notice notice--danger" role="alert">
          <span className="notice__icon" aria-hidden="true">!</span>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
