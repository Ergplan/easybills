'use client';

import { amountInWords, formatMoneyIndian, formatPercentPlain, formatQuantityPlain } from '@/lib/money';
import { formatDateShort } from '@/lib/dates';
import { stateName } from '@/lib/gst/state-codes';
import type { PricedInvoice } from '@/server/services/invoice-calc';

import type { EditorState } from './types';

/**
 * The review step.
 *
 * Every figure shown here came back from the SERVER's calculation of the saved
 * draft, not from the browser's running estimate. The commit button says exactly
 * what it does -- "Issue invoice", never "Generate" -- and it is disabled while
 * any blocker stands, with the reason and the remedy stated in plain words.
 */
export function ReviewPanel({
  priced,
  state,
  blockers,
  issuing,
  error,
  onBack,
  onIssue,
}: {
  priced: PricedInvoice;
  state: EditorState;
  blockers: Array<{ code: string; message: string; whatYouCanDo: string }>;
  issuing: boolean;
  error: string | null;
  onBack: () => void;
  onIssue: () => void;
}) {
  const { totals, computation, assessment } = priced;
  const blocked = blockers.length > 0 || !assessment.canIssue;

  // Lines whose rate the owner has not answered. They price as zero, but the
  // preview must not print "0%" as though that were their answer -- a
  // deliberate nil-rated 0% and an unanswered select would then look identical.
  const unanswered = new Set(state.lines.filter((l) => l.taxRate.trim() === '').map((l) => l.id));

  return (
    <div className="stack">
      <div className="row row--between">
        <button type="button" className="btn btn--ghost" onClick={onBack}>← Back to edit</button>
        <span className="pill pill--draft">DRAFT — not issued</span>
      </div>

      {blockers.length > 0 && (
        <div className="stack stack--tight">
          {blockers.map((b) => (
            <div key={b.code} className="notice notice--warn">
              <span className="notice__icon" aria-hidden="true">!</span>
              <div className="stack" style={{ gap: 4 }}>
                <span className="strong">{b.message}</span>
                <span className="small">{b.whatYouCanDo}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {assessment.notices.map((n) => (
        <div key={n} className="notice notice--info">
          <span className="notice__icon" aria-hidden="true">i</span>
          <span>{n}</span>
        </div>
      ))}

      <section className="card stack" aria-label="Bill summary">
        <div className="row row--between">
          <h2>{assessment.documentTitle}</h2>
          <span className="faint">{formatDateShort(state.issueDate)}</span>
        </div>

        <div className="stack" style={{ gap: 2 }}>
          <span className="faint">Bill to</span>
          <span className="strong">{state.customer.name || 'Walk-in customer'}</span>
          {state.customer.gstin && <span className="faint">GST {state.customer.gstin}</span>}
          {state.customer.phone && <span className="faint">{state.customer.phone}</span>}
        </div>

        {computation.supplyType !== 'no-gst' && (
          <div className="stack" style={{ gap: 2 }}>
            <span className="faint">Place of supply</span>
            <span>
              {stateName(state.placeOfSupplyStateCode)} ·{' '}
              {computation.supplyType === 'intra-state' ? 'Within your state' : 'Another state'}
            </span>
          </div>
        )}

        <hr className="divider" />

        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="num">Qty</th>
                <th scope="col" className="num">Price</th>
                {computation.supplyType !== 'no-gst' && <th scope="col" className="num">GST</th>}
                <th scope="col" className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {computation.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td className="num">{formatQuantityPlain(l.quantityMilli)}{l.unit ? ` ${l.unit}` : ''}</td>
                  <td className="num">{formatMoneyIndian(l.unitPricePaise)}</td>
                  {computation.supplyType !== 'no-gst' && (
                    <td className="num">
                      {/* An unanswered rate prices as zero, but the preview must
                          not print "0%" as though that were the owner's answer. */}
                      {unanswered.has(l.id) ? <span className="muted">not chosen</span> : `${formatPercentPlain(l.taxRateBp)}%`}
                    </td>
                  )}
                  <td className="num">{formatMoneyIndian(l.taxableValuePaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <hr className="divider" />

        <div className="totals">
          <div className="totals__row">
            <span className="muted">Items total</span>
            <span className="amount">{formatMoneyIndian(totals.subtotalPaise)}</span>
          </div>
          {totals.totalDiscountPaise > 0 && (
            <div className="totals__row">
              <span className="muted">Discount</span>
              <span className="amount">− {formatMoneyIndian(totals.totalDiscountPaise)}</span>
            </div>
          )}
          {computation.supplyType !== 'no-gst' && (
            <div className="totals__row">
              <span className="muted">Taxable value</span>
              <span className="amount">{formatMoneyIndian(totals.taxableValuePaise)}</span>
            </div>
          )}
          {totals.cgstPaise > 0 && (
            <div className="totals__row">
              <span className="muted">CGST</span>
              <span className="amount">{formatMoneyIndian(totals.cgstPaise)}</span>
            </div>
          )}
          {totals.sgstPaise > 0 && (
            <div className="totals__row">
              <span className="muted">{computation.stateTaxAuthority ?? 'SGST'}</span>
              <span className="amount">{formatMoneyIndian(totals.sgstPaise)}</span>
            </div>
          )}
          {totals.igstPaise > 0 && (
            <div className="totals__row">
              <span className="muted">IGST</span>
              <span className="amount">{formatMoneyIndian(totals.igstPaise)}</span>
            </div>
          )}
          {totals.cessPaise > 0 && (
            <div className="totals__row">
              <span className="muted">Cess</span>
              <span className="amount">{formatMoneyIndian(totals.cessPaise)}</span>
            </div>
          )}
          {totals.roundOffPaise !== 0 && (
            <div className="totals__row">
              <span className="muted">Rounded off</span>
              <span className="amount">
                {totals.roundOffPaise > 0 ? '+' : '−'} {formatMoneyIndian(Math.abs(totals.roundOffPaise))}
              </span>
            </div>
          )}
          <div className="totals__row totals__row--grand">
            <span>Total</span>
            <span className="amount">{formatMoneyIndian(totals.grandTotalPaise, { withSymbol: true })}</span>
          </div>
        </div>

        <p className="tiny muted">{amountInWords(totals.grandTotalPaise)}</p>

        {computation.headRoundingNote && (
          <p className="tiny muted">{computation.headRoundingNote}</p>
        )}
      </section>

      {error && (
        <div className="notice notice--danger" role="alert">
          <span className="notice__icon" aria-hidden="true">!</span>
          <span>{error}</span>
        </div>
      )}

      <button
        type="button"
        className="btn btn--primary btn--block btn--large"
        disabled={blocked || issuing}
        onClick={onIssue}
      >
        {issuing ? <span className="spinner" aria-hidden="true" /> : null}
        {assessment.documentKind === 'tax-invoice' ? 'Issue invoice' : 'Issue bill'}
      </button>

      {blocked && (
        <p className="tiny muted" style={{ textAlign: 'center' }}>
          Your draft is saved. Nothing is lost.
        </p>
      )}
      {!blocked && (
        <p className="tiny muted" style={{ textAlign: 'center' }}>
          Once issued, this bill gets its number and cannot be edited.
        </p>
      )}
    </div>
  );
}
