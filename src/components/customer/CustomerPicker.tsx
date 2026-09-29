'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { startBillForCustomerAction } from '@/app/actions/invoices';
import { Icon } from '@/components/Icon';
import { t } from '@/lib/copy';
import { initialOf } from '@/lib/domain/home';

export interface PickerCustomer {
  id: string;
  name: string;
  /** One line under the name: what they owe, or when they were last billed. */
  meta: string;
  tone?: 'due' | 'clear' | 'plain';
}

/**
 * Everyone the owner bills, with a search box, the way a directory in a
 * building lists who is on which floor.
 *
 * mode "bill": tapping a name opens a bill for them (and "Naya customer"
 * opens one for someone new). mode "open": tapping a name opens their page.
 */
export function CustomerPicker({
  customers,
  mode,
  limit,
  allHref,
  autoFocus = false,
}: {
  customers: PickerCustomer[];
  mode: 'bill' | 'open';
  /** Show only this many until the owner searches. */
  limit?: number;
  allHref?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return limit ? customers.slice(0, limit) : customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q));
  }, [customers, query, limit]);

  async function startBill(customerId: string | null) {
    setBusy(customerId ?? 'new');
    setError(null);
    const r = await startBillForCustomerAction(customerId);
    if (r.ok) {
      router.push(`/bills/${r.data.invoiceId}${r.data.resumed ? '?resumed=1' : ''}`);
      return;
    }
    setError(r.error);
    setBusy(null);
  }

  const row = (c: PickerCustomer) => {
    const inner = (
      <>
        <span className="person__initial" aria-hidden="true">{initialOf(c.name)}</span>
        <span className="person__text">
          <span className="person__name">{c.name}</span>
          <span className={`person__meta person__meta--${c.tone ?? 'plain'}`}>{c.meta}</span>
        </span>
        <Icon name="chevron" size={18} className="person__go" />
      </>
    );
    return mode === 'open' ? (
      <Link key={c.id} href={`/customers/${c.id}`} className="person">
        {inner}
      </Link>
    ) : (
      <button
        key={c.id}
        type="button"
        className="person"
        disabled={busy !== null}
        aria-busy={busy === c.id}
        onClick={() => void startBill(c.id)}
      >
        {inner}
      </button>
    );
  };

  return (
    <div className="picker">
      {customers.length > 0 && (
        <label className="picker__search">
          <Icon name="search" size={20} />
          <input
            type="search"
            value={query}
            placeholder={t('people.search')}
            aria-label={t('people.search')}
            autoFocus={autoFocus}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}
      <div className="picker__rows">
        {mode === 'bill' && (
          <button
            type="button"
            className="person person--new"
            disabled={busy !== null}
            aria-busy={busy === 'new'}
            onClick={() => void startBill(null)}
          >
            <span className="person__initial" aria-hidden="true">
              <Icon name="plus" size={20} />
            </span>
            <span className="person__text">
              <span className="person__name">{t('home.bill.newCustomer')}</span>
            </span>
            <Icon name="chevron" size={18} className="person__go" />
          </button>
        )}
        {shown.map(row)}
        {customers.length === 0 && mode === 'open' && <p className="muted picker__empty">{t('people.none')}</p>}
        {customers.length > 0 && shown.length === 0 && <p className="muted picker__empty">{t('people.noMatch')}</p>}
      </div>
      {allHref && !query && limit && customers.length > limit && (
        <Link href={allHref} className="btn btn--ghost btn--small" style={{ alignSelf: 'flex-start' }}>
          {t('people.all')} ({customers.length})
        </Link>
      )}
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
