'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { formatDateShort } from '@/lib/dates';
import { formatMoneyPlain } from '@/lib/money';
import type { AdjustmentRecord, InvoiceRecord } from '@/lib/domain/types';
import { Money } from '@/components/Money';
import { createAdjustmentAction } from '@/app/actions/invoices';

/**
 * Correcting an issued bill.
 *
 * The bill itself is never edited. A credit note reduces what the customer
 * owes; a debit note increases it. Both are linked to the original, keep the
 * owner's reason, and are numbered in their own sequence.
 *
 * The question "does this change your GST?" is asked separately and plainly,
 * because reducing what a customer owes and reducing what you owe the
 * government are different things, and the app must not decide which one the
 * owner meant.
 */
export function CorrectionPanel({
  businessId,
  invoice,
  adjustments,
  chargesGst,
}: {
  businessId: string;
  invoice: InvoiceRecord;
  adjustments: AdjustmentRecord[];
  chargesGst: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'credit-note' | 'debit-note'>('credit-note');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [affectsTax, setAffectsTax] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Identifies this submission, so a double tap raises one note rather than
   * two. It is the note's contents plus a nonce fixed when the panel mounted:
   * a retry of the same note is deduplicated, while a second note the owner
   * deliberately types is a different key and is raised. It is renewed after
   * each success, so raising the identical note twice on purpose still works.
   */
  const [nonce, setNonce] = useState(() => crypto.randomUUID());

  const notes = adjustments.filter((a) => a.kind !== 'settlement-deduction');

  return (
    <section className="card stack" aria-labelledby="correct-heading">
      <h2 id="correct-heading">Correct this bill</h2>

      {notes.length > 0 && (
        <div className="stack stack--tight">
          {notes.map((a) => (
            <div key={a.id} className="row row--between small">
              <div className="stack" style={{ gap: 0, minWidth: 0 }}>
                <span className="strong">
                  {a.kind === 'credit-note' ? 'Credit note' : 'Debit note'} {a.number}
                </span>
                <span className="tiny muted truncate">
                  {formatDateShort(a.issueDate)} · {a.reason}
                </span>
                <span className="tiny muted">
                  {a.affectsTaxLiability ? 'Marked as changing your GST' : 'Customer balance only — GST unchanged'}
                </span>
              </div>
              <Money paise={a.kind === 'credit-note' ? -a.amountPaise : a.amountPaise} />
            </div>
          ))}
          <hr className="divider" />
        </div>
      )}

      {!open ? (
        <button type="button" className="btn btn--secondary btn--block" onClick={() => setOpen(true)}>
          Raise a credit or debit note
        </button>
      ) : (
        <div className="stack">
          <p className="muted small">
            An issued bill cannot be changed. Instead we raise a note linked to it, so the original and the
            correction both stay on record.
          </p>

          <div className="segmented" role="group" aria-label="Kind of note">
            <button type="button" className="segmented__option" aria-pressed={kind === 'credit-note'} onClick={() => setKind('credit-note')}>
              Customer owes less
            </button>
            <button type="button" className="segmented__option" aria-pressed={kind === 'debit-note'} onClick={() => setKind('debit-note')}>
              Customer owes more
            </button>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="adj-amount">Amount (₹)</label>
            <input
              id="adj-amount"
              className="input input--numeric"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {kind === 'credit-note' && (
              <span className="field__hint">
                At most {formatMoneyPlain(invoice.totals.grandTotalPaise - invoice.creditAppliedPaise)}.
              </span>
            )}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="adj-reason">Why?</label>
            <input
              id="adj-reason"
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. one visit was billed twice"
            />
            <span className="field__hint">This is kept on record and printed on the note.</span>
          </div>

          {chargesGst && (
            <label className="checkbox-row">
              <input type="checkbox" checked={affectsTax} onChange={(e) => setAffectsTax(e.target.checked)} />
              <span className="stack" style={{ gap: 2 }}>
                <span className="small strong">This changes the GST I owe</span>
                <span className="tiny muted">
                  Leave this unticked if you are only adjusting what the customer owes you. Ask your accountant if
                  you are unsure — the two are not the same, and only this box affects your return.
                </span>
              </span>
            </label>
          )}

          {error && <p className="field__error" role="alert">{error}</p>}

          <div className="row row--tight">
            <button
              type="button"
              className="btn btn--primary grow"
              disabled={busy || !amount.trim() || !reason.trim()}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const paise = Math.round(Number(amount) * 100);
                const r = await createAdjustmentAction(businessId, {
                  invoiceId: invoice.id,
                  kind,
                  amountPaise: paise,
                  reason,
                  affectsTaxLiability: affectsTax,
                  idempotencyKey: [nonce, kind, amount, reason, affectsTax].join('|'),
                });
                setBusy(false);
                if (r.ok) {
                  setNonce(crypto.randomUUID());
                  setOpen(false);
                  setAmount('');
                  setReason('');
                  setAffectsTax(false);
                  router.refresh();
                } else setError(r.error);
              }}
            >
              {busy ? 'Saving…' : `Raise ${kind === 'credit-note' ? 'credit' : 'debit'} note`}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
