'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { startBillForCustomerAction } from '@/app/actions/invoices';
import { Icon } from '@/components/Icon';

/** "Inka bill banao" on a customer's page: a bill for them, their details already on it. */
export function StartBillButton({ customerId, label }: { customerId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="stack stack--tight">
      <button
        type="button"
        className="btn btn--primary btn--block"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await startBillForCustomerAction(customerId);
          if (r.ok) {
            router.push(`/bills/${r.data.invoiceId}${r.data.resumed ? '?resumed=1' : ''}`);
            return;
          }
          setError(r.error);
          setBusy(false);
        }}
      >
        {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="bill-new" size={20} />}
        {label}
      </button>
      {error && <p className="field__error" role="alert">{error}</p>}
    </div>
  );
}
