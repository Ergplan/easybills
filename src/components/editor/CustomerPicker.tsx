'use client';

import { useEffect, useState } from 'react';

import type { CustomerRecord } from '@/lib/domain/types';
import { GST_STATES } from '@/lib/gst/state-codes';
import { checkGstin } from '@/lib/gst/gstin';
import { createCustomerAction, searchCustomersAction } from '@/app/actions/customers';

import type { EditorState } from './types';

type CustomerState = EditorState['customer'];

/**
 * Choosing or creating a customer, inline.
 *
 * For a quick bill the default is "Walk-in customer" and NO customer record is
 * created. For a customer invoice the owner picks from recent customers or adds
 * one here -- they are never sent to the Customers tab to create the first
 * invoice. A new customer needs only a name; everything else appears when it is
 * relevant, and a customer without a GSTIN or PAN is perfectly normal.
 */
export function CustomerPicker({
  businessId,
  isQuickBill,
  recent,
  value,
  chargesGst,
  suppressList = false,
  onChange,
}: {
  businessId: string;
  isQuickBill: boolean;
  recent: CustomerRecord[];
  value: CustomerState;
  chargesGst: boolean;
  /** True while the assistant is asking which customer was meant. */
  suppressList?: boolean;
  onChange: (next: CustomerState) => void;
}) {
  const [mode, setMode] = useState<'picked' | 'search' | 'new'>(value.customerId ? 'picked' : isQuickBill ? 'picked' : 'search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerRecord[]>(recent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (mode !== 'search') return;
    const t = setTimeout(async () => {
      const r = await searchCustomersAction(businessId, query);
      if (r.ok) setResults(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [query, mode, businessId]);

  const set = (patch: Partial<CustomerState>) => onChange({ ...value, ...patch });

  // ------------------------------------------------------------ quick bill
  if (isQuickBill && mode === 'picked' && !value.customerId) {
    return (
      <div className="stack">
        <div className="row row--between">
          <div className="stack" style={{ gap: 2 }}>
            <span className="strong">{value.name || 'Walk-in customer'}</span>
            <span className="faint">No customer record is created.</span>
          </div>
          <button type="button" className="btn btn--ghost" onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? 'Hide details' : 'Add details'}
          </button>
        </div>

        {showDetails && (
          <div className="stack">
            <p className="field__hint">
              Add a name or phone number if you want them printed on the bill, or so you can follow up an unpaid bill.
            </p>
            <div className="field">
              <label className="field__label" htmlFor="walkin-name">Customer name</label>
              <input
                id="walkin-name"
                className="input"
                value={value.name === 'Walk-in customer' ? '' : value.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Walk-in customer"
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="walkin-phone">Phone (optional)</label>
              <input
                id="walkin-phone"
                className="input"
                type="tel"
                inputMode="tel"
                value={value.phone}
                onChange={(e) => set({ phone: e.target.value })}
              />
            </div>
          </div>
        )}

        <button type="button" className="btn btn--ghost" onClick={() => setMode('search')}>
          Bill a saved customer instead
        </button>
      </div>
    );
  }

  // --------------------------------------------------------------- picked
  if (mode === 'picked' && value.name) {
    return (
      <div className="row row--between">
        <div className="stack grow" style={{ gap: 2, minWidth: 0 }}>
          <span className="strong truncate">{value.name}</span>
          {value.phone && <span className="faint">{value.phone}</span>}
          {value.gstin && <span className="faint">GST {value.gstin}</span>}
        </div>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            setMode('search');
            setQuery('');
          }}
        >
          Change
        </button>
      </div>
    );
  }

  // ------------------------------------------------------------- new customer
  if (mode === 'new') {
    return (
      <div className="stack">
        <div className="field">
          <label className="field__label" htmlFor="new-name">Customer name</label>
          <input
            id="new-name"
            className="input"
            value={value.name}
            onChange={(e) => set({ name: e.target.value })}
            autoFocus
            autoComplete="off"
          />
        </div>

        <details className="disclosure">
          <summary>Add address, GST number or contact</summary>
          <div className="disclosure__body stack">
            <div className="field">
              <label className="field__label" htmlFor="new-phone">Phone</label>
              <input id="new-phone" className="input" type="tel" inputMode="tel" value={value.phone} onChange={(e) => set({ phone: e.target.value })} />
              <span className="field__hint">Only needed if you want to send the bill by WhatsApp.</span>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="new-email">Email</label>
              <input id="new-email" className="input" type="email" inputMode="email" value={value.email} onChange={(e) => set({ email: e.target.value })} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="new-address">Address</label>
              <input id="new-address" className="input" value={value.addressLine1} onChange={(e) => set({ addressLine1: e.target.value })} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="new-state">State</label>
              <select id="new-state" className="select" value={value.stateCode} onChange={(e) => set({ stateCode: e.target.value })}>
                <option value="">Not given</option>
                {GST_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            </div>
            {chargesGst && (
              <div className="field">
                <label className="field__label" htmlFor="new-gstin">GST number</label>
                <input
                  id="new-gstin"
                  className="input"
                  value={value.gstin}
                  maxLength={15}
                  style={{ textTransform: 'uppercase' }}
                  onChange={(e) => set({ gstin: e.target.value.toUpperCase() })}
                  aria-invalid={value.gstin.length === 15 && !checkGstin(value.gstin).ok}
                />
                <span className="field__hint">
                  {value.gstin && value.gstin.length === 15
                    ? checkGstin(value.gstin).ok
                      ? `Looks right — ${checkGstin(value.gstin).stateName}`
                      : (checkGstin(value.gstin).message ?? '')
                    : 'Leave blank if your customer is not registered for GST.'}
                </span>
              </div>
            )}
          </div>
        </details>

        {error && <p className="field__error" role="alert">{error}</p>}

        <div className="row row--tight">
          <button
            type="button"
            className="btn btn--primary"
            disabled={saving || !value.name.trim()}
            onClick={async () => {
              setSaving(true);
              setError(null);
              const r = await createCustomerAction(businessId, {
                name: value.name,
                phone: value.phone || null,
                email: value.email || null,
                addressLine1: value.addressLine1 || null,
                addressLine2: null,
                city: value.city || null,
                pincode: value.pincode || null,
                stateCode: value.stateCode || null,
                gstin: value.gstin || null,
                pan: value.pan || null,
                notes: null,
              });
              setSaving(false);
              if (r.ok) {
                onChange({ ...value, customerId: r.data.id });
                setMode('picked');
              } else {
                setError(r.error);
              }
            }}
          >
            {saving ? 'Saving…' : 'Use this customer'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setMode('search')}>Cancel</button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ search
  return (
    <div className="stack">
      <div className="field">
        <label className="field__label" htmlFor="cust-search">Search your customers</label>
        <input
          id="cust-search"
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name or phone"
          autoComplete="off"
        />
      </div>

      {suppressList && (
        <p className="field__hint">Choose a customer in the box above, or search here instead.</p>
      )}

      {results.length > 0 && !suppressList && (
        <div className="card card--flush">
          <div className="list">
            {results.slice(0, 6).map((c) => (
              <button
                key={c.id}
                type="button"
                className="list__item"
                onClick={() => {
                  onChange({
                    customerId: c.id,
                    name: c.name,
                    phone: c.phone ?? '',
                    email: c.email ?? '',
                    addressLine1: c.addressLine1 ?? '',
                    city: c.city ?? '',
                    pincode: c.pincode ?? '',
                    stateCode: c.stateCode ?? '',
                    gstin: c.gstin ?? '',
                    pan: c.pan ?? '',
                  });
                  setMode('picked');
                }}
              >
                <span className="grow truncate">{c.name}</span>
                {c.phone && <span className="faint">{c.phone}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        className="btn btn--secondary btn--block"
        onClick={() => {
          onChange({ ...value, customerId: null, name: query });
          setMode('new');
        }}
      >
        + Add {query.trim() ? `"${query.trim()}"` : 'a new customer'}
      </button>

      {isQuickBill && (
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            onChange({ ...value, customerId: null, name: 'Walk-in customer' });
            setMode('picked');
          }}
        >
          Back to walk-in customer
        </button>
      )}
    </div>
  );
}
