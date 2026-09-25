'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { formatDateShort } from '@/lib/dates';
import { Money, StatusPill } from '@/components/Money';
import type { BillFilter, BillListItem } from '@/server/services/bill-search';

const FILTERS: Array<{ key: BillFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'paid', label: 'Paid' },
];

export function BillsList({
  initialBills,
  filter,
  query,
}: {
  businessId: string;
  initialBills: BillListItem[];
  filter: BillFilter;
  query: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(query);

  // Push the search term into the URL so the list is shareable and back works.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (q.trim()) next.set('q', q.trim());
      else next.delete('q');
      router.replace(`/bills?${next.toString()}`);
    }, 300);
    return () => clearTimeout(t);
    // `params` changes identity on every render; the search term is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const setFilter = (key: BillFilter) => {
    const next = new URLSearchParams(params.toString());
    next.delete('status');
    if (key === 'all') next.delete('filter');
    else next.set('filter', key);
    router.replace(`/bills?${next.toString()}`);
  };

  return (
    <div className="stack">
      <div className="field">
        <label className="field__label sr-only" htmlFor="bill-search">Search bills</label>
        <input
          id="bill-search"
          className="input"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by customer, number or date"
        />
      </div>

      <div className="segmented" role="group" aria-label="Filter bills">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className="segmented__option"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filter === 'monthly' && (
        <div className="notice notice--info">
          <span className="notice__icon" aria-hidden="true">i</span>
          <span>These are the monthly drafts we prepared. Check each one, then issue it.</span>
        </div>
      )}

      {initialBills.length === 0 ? (
        <div className="card empty">
          <span className="empty__icon" aria-hidden="true">🧾</span>
          <p>{q ? 'No bills match that search.' : 'No bills yet.'}</p>
          {!q && (
            <Link href="/bills/new" className="btn btn--primary" style={{ marginTop: 12 }}>
              Create your first bill
            </Link>
          )}
        </div>
      ) : (
        <div className="card card--flush">
          <div className="list">
            {initialBills.map((b) => (
              <Link key={b.id} href={`/bills/${b.id}`} className="list__item">
                <div className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                  <span className="strong truncate">{b.customerName}</span>
                  <span className="faint">
                    {b.number ? `${b.number} · ` : ''}
                    {formatDateShort(b.issueDate)}
                    {b.fromSchedule && b.status === 'draft' ? ' · monthly' : ''}
                  </span>
                  {b.isOverdue && (
                    <span className="tiny" style={{ color: 'var(--danger)', fontWeight: 650 }}>
                      Past due {b.dueDate ? formatDateShort(b.dueDate) : ''}
                    </span>
                  )}
                </div>
                <div className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
                  <Money paise={b.grandTotalPaise} />
                  <StatusPill status={b.status === 'draft' ? 'draft' : b.status === 'cancelled' ? 'cancelled' : b.paymentStatus} />
                  {b.status === 'issued' && b.balancePaise > 0 && b.balancePaise !== b.grandTotalPaise && (
                    <span className="tiny muted">
                      <Money paise={b.balancePaise} symbol={false} /> left
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
