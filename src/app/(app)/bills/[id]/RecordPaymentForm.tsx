'use client';

import { useState } from 'react';

import { todayIst } from '@/lib/dates';
import { formatMoneyPlain } from '@/lib/money';
import type { InvoiceRecord, PaymentMethod } from '@/lib/domain/types';
import { recordDeductionAction, recordPaymentAction } from '@/app/actions/invoices';

const METHODS: Array<{ key: PaymentMethod; label: string }> = [
  { key: 'cash', label: 'Cash' },
  { key: 'upi', label: 'UPI' },
  { key: 'bank-transfer', label: 'Bank transfer' },
  { key: 'cheque', label: 'Cheque' },
  { key: 'card', label: 'Card' },
  { key: 'other', label: 'Other' },
];

/**
 * "Payment received" -- amount, date, method, optional reference.
 *
 * A deduction the customer withheld at settlement is entered separately and is
 * labelled as such: it is neither cash received nor a discount, and it does not
 * change the invoice total or the tax on it. This release does not calculate it;
 * the owner enters what was actually withheld.
 */
export function RecordPaymentForm({
  businessId,
  invoice,
  onCancel,
  onDone,
}: {
  businessId: string;
  invoice: InvoiceRecord;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<'payment' | 'deduction'>('payment');
  const [amount, setAmount] = useState(formatMoneyPlain(Math.max(0, invoice.balancePaise)));
  const [receivedOn, setReceivedOn] = useState(todayIst());
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Identifies this submission, so a double tap or a retry after a dropped
   * response records the money once.
   *
   * It is the form's contents plus a nonce fixed when the form opened: the same
   * submission retried carries the same key and is deduplicated, while a second
   * payment the owner deliberately types is a different key and is recorded.
   * It is renewed after each success, so two identical payments still work.
   */
  const [nonce, setNonce] = useState(() => crypto.randomUUID());
  const submissionKey = () => [nonce, mode, amount, receivedOn, method, reference, reason].join('|');

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'payment') {
        const paise = Math.round(Number(amount) * 100);
        const r = await recordPaymentAction(businessId, {
          customerId: invoice.customer.customerId,
          receivedOn,
          amountPaise: amount,
          method,
          reference: reference || null,
          note: null,
          allocations: [{ invoiceId: invoice.id, amountPaise: formatMoneyPlain(Math.min(paise, invoice.balancePaise)) }],
          idempotencyKey: submissionKey(),
        });
        if (r.ok) {
          setNonce(crypto.randomUUID());
          onDone();
        } else setError(r.error);
      } else {
        const r = await recordDeductionAction(
          businessId,
          invoice.id,
          Math.round(Number(amount) * 100),
          reason,
          submissionKey(),
        );
        if (r.ok) {
          setNonce(crypto.randomUUID());
          onDone();
        } else setError(r.error);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ paddingTop: 8, borderTop: '1px solid var(--line)' }}>
      <div className="segmented" role="group" aria-label="What are you recording?">
        <button type="button" className="segmented__option" aria-pressed={mode === 'payment'} onClick={() => setMode('payment')}>
          Money received
        </button>
        <button type="button" className="segmented__option" aria-pressed={mode === 'deduction'} onClick={() => setMode('deduction')}>
          Amount deducted
        </button>
      </div>

      {mode === 'deduction' && (
        <div className="notice notice--info">
          <span className="notice__icon" aria-hidden="true">i</span>
          <span className="small">
            Use this when your customer paid you less than the bill because they held something back, such as TDS.
            It is not counted as cash received, and it does not change the bill or the GST on it.
          </span>
        </div>
      )}

      <div className="field">
        <label className="field__label" htmlFor="pay-amount">Amount (₹)</label>
        <input
          id="pay-amount"
          className="input input--numeric"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoFocus
        />
        <span className="field__hint">Still to collect: {formatMoneyPlain(Math.max(0, invoice.balancePaise))}</span>
      </div>

      {mode === 'payment' ? (
        <>
          <div className="field">
            <label className="field__label" htmlFor="pay-date">Date received</label>
            <input
              id="pay-date"
              className="input"
              type="date"
              value={receivedOn}
              max={todayIst()}
              onChange={(e) => setReceivedOn(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="pay-method">How was it paid?</label>
            <select id="pay-method" className="select" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="pay-ref">Reference (optional)</label>
            <input id="pay-ref" className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI ref, cheque number" />
          </div>
        </>
      ) : (
        <div className="field">
          <label className="field__label" htmlFor="ded-reason">Why was it deducted?</label>
          <input id="ded-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. TDS, certificate received" />
        </div>
      )}

      {error && <p className="field__error" role="alert">{error}</p>}

      <div className="row row--tight">
        <button type="button" className="btn btn--primary grow" disabled={busy || !amount.trim()} onClick={() => void submit()}>
          {busy ? 'Saving…' : mode === 'payment' ? 'Record payment' : 'Record deduction'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>

      <p className="tiny muted">
        A screenshot or a customer&rsquo;s message is not proof of payment. Record it here once the money has actually
        reached you.
      </p>
    </div>
  );
}
