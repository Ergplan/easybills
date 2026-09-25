'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { formatDateShort, todayIst } from '@/lib/dates';
import { formatMoneyIndian, formatPercentPlain, formatQuantityPlain } from '@/lib/money';
import { stateName } from '@/lib/gst/state-codes';
import type { AdjustmentRecord, InvoiceRecord, PaymentRecord, RecurringScheduleRecord } from '@/lib/domain/types';
import { Money, StatusPill } from '@/components/Money';
import { duplicateInvoiceAction, recordPaymentAction, reversePaymentAction } from '@/app/actions/invoices';

import { CorrectionPanel } from './CorrectionPanel';
import { RecordPaymentForm } from './RecordPaymentForm';
import { RepeatMonthly } from './RepeatMonthly';
import { ShareActions } from './ShareActions';

/**
 * An issued bill.
 *
 * Nothing here can change the document. Editing is gone; what remains is
 * sharing it, recording what was actually received against it, and duplicating
 * it into a NEW draft. The figures shown come from the invoice's own snapshot.
 */
export function IssuedInvoiceView({
  businessId,
  invoice,
  payments,
  adjustments,
  schedule,
}: {
  businessId: string;
  invoice: InvoiceRecord;
  payments: PaymentRecord[];
  adjustments: AdjustmentRecord[];
  schedule: RecurringScheduleRecord | null;
}) {
  const router = useRouter();
  const [showPayment, setShowPayment] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const snap = invoice.issued!;
  const isOverdue = invoice.balancePaise > 0 && invoice.dueDate && invoice.dueDate < todayIst();

  return (
    <div className="stack">
      <div className="row row--between">
        <StatusPill status={invoice.paymentStatus} />
        <span className="faint">
          {snap.documentTitle}
          {invoice.number ? ` · ${invoice.number}` : ''}
        </span>
      </div>

      <section className="card stack">
        <div className="row row--between">
          <div className="stack" style={{ gap: 2 }}>
            <span className="faint">Bill to</span>
            <span className="strong" style={{ fontSize: '1.05rem' }}>{snap.customer.name}</span>
            {snap.customer.gstin && <span className="faint">GST {snap.customer.gstin}</span>}
          </div>
          <div className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
            <span className="faint">{formatDateShort(invoice.issueDate)}</span>
            {invoice.dueDate && (
              <span className={isOverdue ? 'tiny' : 'faint'} style={isOverdue ? { color: 'var(--danger)', fontWeight: 650 } : undefined}>
                Due {formatDateShort(invoice.dueDate)}
              </span>
            )}
          </div>
        </div>

        {invoice.billingPeriod && (
          <p className="faint">
            For work from {formatDateShort(invoice.billingPeriod.from)} to {formatDateShort(invoice.billingPeriod.to)}
          </p>
        )}

        <hr className="divider" />

        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="num">Qty</th>
                <th scope="col" className="num">Rate</th>
                {snap.supplyType !== 'no-gst' && <th scope="col" className="num">GST</th>}
                <th scope="col" className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td className="num">{formatQuantityPlain(l.quantityMilli)}</td>
                  <td className="num">{formatMoneyIndian(l.unitPricePaise)}</td>
                  {snap.supplyType !== 'no-gst' && <td className="num">{formatPercentPlain(l.taxRateBp)}%</td>}
                  <td className="num">
                    {formatMoneyIndian(Math.round((l.quantityMilli * l.unitPricePaise) / 1000) - l.discountPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <hr className="divider" />

        <div className="totals">
          {snap.supplyType !== 'no-gst' && (
            <>
              <div className="totals__row">
                <span className="muted">Taxable value</span>
                <span className="amount">{formatMoneyIndian(invoice.totals.taxableValuePaise)}</span>
              </div>
              {invoice.totals.cgstPaise > 0 && (
                <div className="totals__row">
                  <span className="muted">CGST</span>
                  <span className="amount">{formatMoneyIndian(invoice.totals.cgstPaise)}</span>
                </div>
              )}
              {invoice.totals.sgstPaise > 0 && (
                <div className="totals__row">
                  <span className="muted">SGST/UTGST</span>
                  <span className="amount">{formatMoneyIndian(invoice.totals.sgstPaise)}</span>
                </div>
              )}
              {invoice.totals.igstPaise > 0 && (
                <div className="totals__row">
                  <span className="muted">IGST</span>
                  <span className="amount">{formatMoneyIndian(invoice.totals.igstPaise)}</span>
                </div>
              )}
            </>
          )}
          <div className="totals__row totals__row--grand">
            <span>Total</span>
            <span className="amount">{formatMoneyIndian(invoice.totals.grandTotalPaise, { withSymbol: true })}</span>
          </div>
        </div>

        {snap.placeOfSupplyStateCode && snap.supplyType !== 'no-gst' && (
          <p className="tiny muted">
            Place of supply: {stateName(snap.placeOfSupplyStateCode)} ·{' '}
            {snap.supplyType === 'intra-state' ? 'within your state' : 'another state'}
          </p>
        )}
      </section>

      {/* ------------------------------------------------------- collection */}
      <section className="card stack" aria-labelledby="payment-heading">
        <div className="row row--between">
          <h2 id="payment-heading">Payment</h2>
          <StatusPill status={invoice.paymentStatus} />
        </div>

        <div className="row row--between">
          <span className="muted">Still to collect</span>
          <Money paise={Math.max(0, invoice.balancePaise)} big />
        </div>

        {invoice.amountPaidPaise > 0 && (
          <div className="row row--between small">
            <span className="muted">Received</span>
            <Money paise={invoice.amountPaidPaise} />
          </div>
        )}
        {invoice.creditAppliedPaise > 0 && (
          <div className="row row--between small">
            <span className="muted">Credit notes</span>
            <span>− <Money paise={invoice.creditAppliedPaise} symbol={false} /></span>
          </div>
        )}
        {invoice.debitAppliedPaise > 0 && (
          <div className="row row--between small">
            <span className="muted">Debit notes</span>
            <span>+ <Money paise={invoice.debitAppliedPaise} symbol={false} /></span>
          </div>
        )}
        {invoice.settlementDeductionPaise > 0 && (
          <div className="row row--between small">
            <span className="muted">Deducted at settlement (not cash received)</span>
            <Money paise={invoice.settlementDeductionPaise} />
          </div>
        )}

        {invoice.balancePaise > 0 && !showPayment && (
          <button type="button" className="btn btn--primary btn--block btn--large" onClick={() => setShowPayment(true)}>
            Payment received
          </button>
        )}

        {showPayment && (
          <RecordPaymentForm
            businessId={businessId}
            invoice={invoice}
            onCancel={() => setShowPayment(false)}
            onDone={() => {
              setShowPayment(false);
              router.refresh();
            }}
          />
        )}

        {payments.length > 0 && (
          <>
            <hr className="divider" />
            <span className="field__label">History</span>
            <div className="stack stack--tight">
              {payments.map((p) => {
                const allocated = p.allocations.find((a) => a.invoiceId === invoice.id)?.amountPaise ?? 0;
                const isReversal = p.reversalOfPaymentId !== null;
                return (
                  <div key={p.id} className="row row--between small">
                    <div className="stack" style={{ gap: 0 }}>
                      <span>
                        {isReversal ? 'Reversed' : 'Received'} · {formatDateShort(p.receivedOn)} · {p.method}
                      </span>
                      {p.note && <span className="tiny muted">{p.note}</span>}
                      {p.reversedByPaymentId && <span className="tiny muted">This payment was later reversed.</span>}
                    </div>
                    <div className="row row--tight">
                      <Money paise={allocated} />
                      {!isReversal && !p.reversedByPaymentId && (
                        <button
                          type="button"
                          className="btn btn--ghost tiny"
                          style={{ paddingInline: 8 }}
                          disabled={busy}
                          onClick={async () => {
                            const reason = window.prompt('Why is this payment being reversed? (e.g. cheque bounced)');
                            if (!reason) return;
                            setBusy(true);
                            const r = await reversePaymentAction(businessId, p.id, reason);
                            setBusy(false);
                            if (r.ok) router.refresh();
                            else setError(r.error);
                          }}
                        >
                          Reverse
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <ShareActions businessId={businessId} invoice={invoice} />

      <CorrectionPanel
        businessId={businessId}
        invoice={invoice}
        adjustments={adjustments}
        chargesGst={snap.supplyType !== 'no-gst'}
      />

      <RepeatMonthly
        businessId={businessId}
        invoiceId={invoice.id}
        issueDate={invoice.issueDate}
        hasCustomer={Boolean(invoice.customer.customerId)}
        existing={schedule}
      />

      <button
        type="button"
        className="btn btn--secondary btn--block"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await duplicateInvoiceAction(businessId, invoice.id);
          setBusy(false);
          if (r.ok) router.push(`/bills/${r.data.invoiceId}`);
          else setError(r.error);
        }}
      >
        Duplicate as a new bill
      </button>

      {error && (
        <div className="notice notice--danger" role="alert">
          <span className="notice__icon" aria-hidden="true">!</span>
          <span>{error}</span>
        </div>
      )}

      <p className="tiny muted" style={{ textAlign: 'center' }}>
        Issued {formatDateShort(invoice.issueDate)}. An issued bill cannot be changed — use a credit note if something
        was wrong.
      </p>
    </div>
  );
}
