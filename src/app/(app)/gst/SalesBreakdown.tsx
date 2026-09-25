'use client';

import Link from 'next/link';

import { formatDateShort } from '@/lib/dates';
import { formatMoneyIndian, formatPercentPlain, formatQuantityPlain } from '@/lib/money';
import { stateName } from '@/lib/gst/state-codes';
import { hsnRowLabel, type Gstr1Tables } from '@/lib/gst-returns/workings';

/**
 * The outward tables, opened up.
 *
 * A return is a claim about specific documents. An owner asked to approve one
 * should be able to get from any figure to the bills behind it -- otherwise
 * "check your sales" means "trust our total". Every row here either links to
 * the bill it came from or says plainly that it was imported from elsewhere.
 *
 * It lives behind a disclosure so step 1 stays a short screen for the common
 * case, where the owner just wants to confirm the month looks right.
 */
export function SalesBreakdown({ tables }: { tables: Gstr1Tables }) {
  const nothing =
    tables.b2b.length === 0 && tables.b2cSummary.length === 0 && tables.creditDebitNotes.length === 0;

  if (nothing) return null;

  const tax = (r: { cgstPaise: number; sgstPaise: number; igstPaise: number; cessPaise: number }) =>
    r.cgstPaise + r.sgstPaise + r.igstPaise + r.cessPaise;

  return (
    <details className="disclosure">
      <summary>See every sale behind these figures</summary>
      <div className="disclosure__body stack">
        <p className="tiny muted">
          Every line here can be opened. If a figure looks wrong, this is where you find the bill that caused it.
        </p>

        {/* ---------------------------------------------------- registered */}
        {tables.b2b.length > 0 && (
          <section className="stack stack--tight">
            <span className="field__label">Sales to GST-registered customers</span>
            {tables.b2b.map((group) => (
              <div key={group.customerGstin} className="line-item stack stack--tight">
                <div className="row row--between">
                  <span className="small strong truncate">{group.customerName}</span>
                  <span className="tiny muted">{group.customerGstin}</span>
                </div>
                {group.documents.map((doc) => (
                  <div key={doc.documentNumber} className="row row--between small">
                    <div className="stack" style={{ gap: 0, minWidth: 0 }}>
                      {doc.sourceInvoiceId ? (
                        <Link href={`/bills/${doc.sourceInvoiceId}`} className="strong">
                          {doc.documentNumber}
                        </Link>
                      ) : (
                        <span className="strong">{doc.documentNumber}</span>
                      )}
                      <span className="tiny muted">
                        {formatDateShort(doc.documentDate)}
                        {doc.placeOfSupplyStateCode ? ` · ${stateName(doc.placeOfSupplyStateCode)}` : ''}
                        {doc.sourceInvoiceId ? '' : ' · imported'}
                      </span>
                    </div>
                    <span className="amount">{formatMoneyIndian(doc.invoiceValuePaise)}</span>
                  </div>
                ))}
              </div>
            ))}
          </section>
        )}

        {/* -------------------------------------------------- unregistered */}
        {tables.b2cSummary.length > 0 && (
          <section className="stack stack--tight">
            <span className="field__label">Sales to everyone else, grouped</span>
            <p className="tiny muted">
              These are reported as a total per state and rate, not one by one — but the bills are still here.
            </p>
            {tables.b2cSummary.map((row) => (
              <details key={`${row.placeOfSupplyStateCode}-${row.taxRateBp}`} className="line-item">
                <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="grow small">
                    {row.placeOfSupplyStateCode ? stateName(row.placeOfSupplyStateCode) : 'No state recorded'} ·{' '}
                    {formatPercentPlain(row.taxRateBp)}%
                  </span>
                  <span className="tiny muted">{row.documentCount} bill{row.documentCount === 1 ? '' : 's'}</span>
                  <span className="amount">{formatMoneyIndian(row.taxableValuePaise)}</span>
                </summary>
                <div className="stack stack--tight" style={{ paddingTop: 10 }}>
                  <div className="row row--between tiny">
                    <span className="muted">Tax in this group</span>
                    <span className="amount">{formatMoneyIndian(tax(row))}</span>
                  </div>
                  {row.sourceInvoiceIds.length > 0 ? (
                    <>
                      <div className="row row--tight" style={{ flexWrap: 'wrap' }}>
                        {row.sourceInvoiceIds.map((id, i) => (
                          <Link
                            key={id}
                            href={`/bills/${id}`}
                            className="btn btn--secondary"
                            style={{ fontSize: '0.8125rem', paddingInline: 10 }}
                          >
                            Open bill {i + 1}
                          </Link>
                        ))}
                      </div>
                      {row.documentCount > row.sourceInvoiceIds.length && (
                        <span className="tiny muted">
                          The other{' '}
                          {row.documentCount - row.sourceInvoiceIds.length === 1
                            ? 'sale came'
                            : `${row.documentCount - row.sourceInvoiceIds.length} sales came`}{' '}
                          from an import, so there is no bill here to open.
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="tiny muted">
                      {row.documentCount === 1 ? 'This sale came' : 'These sales came'} from an import, so there is no
                      bill here to open.
                    </span>
                  )}
                </div>
              </details>
            ))}
          </section>
        )}

        {/* ------------------------------------------------ notes ---------- */}
        {tables.creditDebitNotes.length > 0 && (
          <section className="stack stack--tight">
            <span className="field__label">Credit and debit notes</span>
            {tables.creditDebitNotes.map((n) => (
              <div key={n.documentNumber} className="row row--between small">
                <div className="stack" style={{ gap: 0 }}>
                  <span className="strong">{n.documentNumber}</span>
                  <span className="tiny muted">
                    {n.documentType === 'credit-note' ? 'Credit note' : 'Debit note'} · {formatDateShort(n.documentDate)}
                  </span>
                </div>
                <span className="amount">
                  {n.documentType === 'credit-note' ? '− ' : ''}
                  {formatMoneyIndian(n.taxableValuePaise)}
                </span>
              </div>
            ))}
          </section>
        )}

        {/* ------------------------------------------------------- HSN ----- */}
        {tables.hsnSummary.length > 0 && (
          <section className="stack stack--tight">
            <span className="field__label">What you sold, by code</span>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">HSN/SAC</th>
                    <th scope="col">Description</th>
                    <th scope="col" className="num">Qty</th>
                    <th scope="col" className="num">Rate</th>
                    <th scope="col" className="num">Taxable</th>
                    <th scope="col" className="num">Tax</th>
                  </tr>
                </thead>
                <tbody>
                  {tables.hsnSummary.map((h, i) => (
                    <tr key={`${h.hsnCode ?? 'none'}-${h.taxRateBp}-${i}`}>
                      <td>{h.hsnCode ?? '—'}</td>
                      <td>{hsnRowLabel(h)}</td>
                      <td className="num">{formatQuantityPlain(h.quantityMilli)}</td>
                      <td className="num">{formatPercentPlain(h.taxRateBp)}%</td>
                      <td className="num">{formatMoneyIndian(h.taxableValuePaise)}</td>
                      <td className="num">{formatMoneyIndian(tax(h))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {tables.hsnSummary.some((h) => !h.hsnCode) && (
              <p className="tiny muted">
                Some items have no HSN/SAC code. Whether you need one depends on your business size — ask your
                accountant if you are not sure.
              </p>
            )}
          </section>
        )}

        {/* --------------------------------------------- document summary -- */}
        {tables.documentSummary.length > 0 && (
          <section className="stack stack--tight">
            <span className="field__label">Bill numbers used this period</span>
            {tables.documentSummary.map((d) => (
              <div key={`${d.from}-${d.to}`} className="row row--between small">
                <span>
                  {d.from} to {d.to}
                </span>
                <span className="tiny muted">
                  {d.total} issued{d.cancelled ? ` · ${d.cancelled} cancelled` : ''}
                </span>
              </div>
            ))}
          </section>
        )}

        {/* --------------------------------------------------- the total --- */}
        <div className="totals" style={{ paddingTop: 8, borderTop: '1px solid var(--line)' }}>
          <div className="totals__row">
            <span className="muted">Taxable value of everything above</span>
            <span className="amount">{formatMoneyIndian(tables.totals.taxableValuePaise)}</span>
          </div>
          <div className="totals__row">
            <span className="muted">Tax on it</span>
            <span className="amount">{formatMoneyIndian(tax(tables.totals))}</span>
          </div>
        </div>
      </div>
    </details>
  );
}
