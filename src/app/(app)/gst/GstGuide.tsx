'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { addMonthsToPeriod, formatPeriodLong } from '@/lib/dates';
import { formatMoneyIndian } from '@/lib/money';
import { RETURN_STATUS_LABELS, type ReturnStatus } from '@/lib/gst-returns/types';
import type { CompletenessDeclaration } from '@/lib/gst-returns/types';
import type { PreparedPeriod } from '@/server/gst/prepare';
import type { FilingFrequency } from '@/lib/domain/types';
import { Money } from '@/components/Money';
import {
  approveForFilingAction,
  attachFilingEvidenceAction,
  declareCompletenessAction,
  importGstr2bAction,
  importSupplierBillsAction,
  resolveFindingAction,
  reviewItcAction,
} from '@/app/actions/gst';

type Step = 1 | 2 | 3 | 4;

const STEPS: Array<{ n: Step; title: string; plain: string }> = [
  { n: 1, title: 'Check sales', plain: 'Everything you billed this period' },
  { n: 2, title: 'Check purchases', plain: 'What you bought, and the credit you can claim' },
  { n: 3, title: 'Review GST', plain: 'What you owe, and why' },
  { n: 4, title: 'File or hand over', plain: 'Send it, or give it to your accountant' },
];

/**
 * The guided return. Four steps, in order, each one thing.
 *
 * The rule the whole screen obeys: it never says a return is further along than
 * it is. "Prepared", "Ready", "Uploaded" and "Filed" are different words with
 * different meanings, and the difference is stated wherever it could matter.
 */
export function GstGuide({
  businessId,
  businessName,
  prepared,
  status,
  completeness,
  filingCapability,
  filingFrequency,
}: {
  businessId: string;
  businessName: string;
  prepared: PreparedPeriod;
  status: ReturnStatus;
  completeness: CompletenessDeclaration | null;
  filingCapability: { mode: string; available: boolean; environment: string; productionVerified: boolean; reason: string | null };
  periodId: string;
  filingFrequency: FilingFrequency;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [answers, setAnswers] = useState({
    allSalesIncluded: completeness?.allSalesIncluded ?? false,
    allPurchasesIncluded: completeness?.allPurchasesIncluded ?? false,
    otherLiabilitiesConsidered: completeness?.otherLiabilitiesConsidered ?? false,
    confirmedNilIfEmpty: completeness?.confirmedNilIfEmpty ?? false,
  });

  const { summary, readiness, gstr3b, gstr1 } = prepared;

  async function upload(kind: 'purchases' | 'statement', file: File) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const contents = await file.text();
      const r =
        kind === 'purchases'
          ? await importSupplierBillsAction(businessId, { filename: file.name, contents, period: prepared.period })
          : await importGstr2bAction(businessId, { filename: file.name, contents, period: prepared.period, generatedAt: null });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (kind === 'purchases') {
        const d = r.data as { imported: number; duplicates: number; rejected: number; alreadyImported: boolean };
        setMessage(
          d.alreadyImported
            ? 'That file has already been imported, so nothing was added again.'
            : `Added ${d.imported} purchase ${d.imported === 1 ? 'bill' : 'bills'}.` +
              (d.duplicates ? ` Skipped ${d.duplicates} already in your records.` : '') +
              (d.rejected ? ` ${d.rejected} row(s) could not be read.` : ''),
        );
      } else {
        const d = r.data as { rows: number };
        setMessage(`Imported ${d.rows} entries from the statement.`);
      }
      router.refresh();
    } catch {
      setError('We could not read that file.');
    } finally {
      setBusy(false);
    }
  }

  const periodLabel = formatPeriodLong(prepared.period);

  return (
    <div className="stack">
      {/* ------------------------------------------------------------ header */}
      <section className="card stack">
        <div className="row row--between">
          <div className="stack" style={{ gap: 2 }}>
            <h2>GST for {periodLabel}</h2>
            <span className="faint">{businessName} · {prepared.gstin}</span>
          </div>
          <span className={`pill ${status === 'filed' ? 'pill--paid' : status === 'ready' ? 'pill--info' : 'pill--draft'}`}>
            {RETURN_STATUS_LABELS[status]}
          </span>
        </div>

        <div className="row row--tight">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => router.push(`/gst?period=${addMonthsToPeriod(prepared.period, -1)}`)}
          >
            ← Earlier
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => router.push(`/gst?period=${addMonthsToPeriod(prepared.period, 1)}`)}
          >
            Later →
          </button>
        </div>

        {/* Never a fabricated deadline. */}
        <p className="tiny muted">
          {prepared.dueDateVerified
            ? `Due date: ${prepared.dueDate}`
            : 'We are not showing a due date, because we could not confirm it from the official source. Please check the GST portal, or ask your accountant.'}
          {' · '}
          {summary.salesCount} sales · {summary.purchaseCount} purchases
        </p>
      </section>

      {/* ------------------------------------------------------------- steps */}
      <div className="segmented" role="group" aria-label="Steps">
        {STEPS.map((s) => (
          <button key={s.n} type="button" className="segmented__option" aria-pressed={step === s.n} onClick={() => setStep(s.n)}>
            {s.n}. {s.title}
          </button>
        ))}
      </div>

      {message && (
        <div className="notice notice--ok" role="status">
          <span className="notice__icon" aria-hidden="true">✓</span>
          <span className="small">{message}</span>
        </div>
      )}
      {error && (
        <div className="notice notice--danger" role="alert">
          <span className="notice__icon" aria-hidden="true">!</span>
          <span className="small">{error}</span>
        </div>
      )}

      {/* ===================================================== 1. CHECK SALES */}
      {step === 1 && (
        <section className="card stack" aria-labelledby="s1">
          <h3 id="s1">Check sales</h3>
          <p className="muted small">Everything you billed for {periodLabel}.</p>

          <div className="row row--between">
            <span className="muted">Bills raised here</span>
            <span className="strong">{summary.salesCount}</span>
          </div>
          <div className="row row--between">
            <span className="muted">Sales value</span>
            <Money paise={gstr1.totals.taxableValuePaise} />
          </div>
          <div className="row row--between">
            <span className="muted">GST on sales</span>
            <Money paise={gstr1.totals.cgstPaise + gstr1.totals.sgstPaise + gstr1.totals.igstPaise + gstr1.totals.cessPaise} />
          </div>

          <hr className="divider" />

          <div className="notice notice--warn">
            <span className="notice__icon" aria-hidden="true">?</span>
            <span className="small">
              Your bills from this app are counted automatically. We cannot know about anything billed elsewhere, so
              please tell us.
            </span>
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={answers.allSalesIncluded}
              onChange={(e) => setAnswers({ ...answers, allSalesIncluded: e.target.checked })}
            />
            <span className="small">All my sales for {periodLabel} are here.</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={answers.allPurchasesIncluded}
              onChange={(e) => setAnswers({ ...answers, allPurchasesIncluded: e.target.checked })}
            />
            <span className="small">All my purchases for {periodLabel} are here.</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={answers.otherLiabilitiesConsidered}
              onChange={(e) => setAnswers({ ...answers, otherLiabilitiesConsidered: e.target.checked })}
            />
            <span className="small">
              I have checked whether I owe tax on anything else this period (such as tax I pay myself on a purchase,
              imports, or advances).
            </span>
          </label>
          {summary.salesCount === 0 && summary.purchaseCount === 0 && (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={answers.confirmedNilIfEmpty}
                onChange={(e) => setAnswers({ ...answers, confirmedNilIfEmpty: e.target.checked })}
              />
              <span className="small">
                I had no business at all in {periodLabel}. (We will not assume this just because the app is empty.)
              </span>
            </label>
          )}

          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await declareCompletenessAction(businessId, prepared.period, 'GSTR-3B', answers);
              setBusy(false);
              if (r.ok) {
                setMessage('Saved. Now check your purchases.');
                setStep(2);
                router.refresh();
              } else setError(r.error);
            }}
          >
            Save and continue
          </button>
        </section>
      )}

      {/* ================================================= 2. CHECK PURCHASES */}
      {step === 2 && (
        <section className="card stack" aria-labelledby="s2">
          <h3 id="s2">Check purchases</h3>
          <p className="muted small">
            Add your supplier bills, then import your GSTR-2B from the portal so we can check them against each other.
          </p>

          <div className="field">
            <label className="field__label" htmlFor="up-purchases">Purchase bills (CSV)</label>
            <input
              id="up-purchases"
              className="input"
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload('purchases', f);
                e.target.value = '';
              }}
            />
            <span className="field__hint">
              Columns: supplier_gstin, supplier_name, document_number, document_date, taxable_value, cgst, sgst, igst, cess
            </span>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="up-2b">GSTR-2B from the GST portal (CSV)</label>
            <input
              id="up-2b"
              className="input"
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload('statement', f);
                e.target.value = '';
              }}
            />
            {prepared.snapshot && (
              <span className="field__hint">
                Imported {new Date(prepared.snapshot.importedAt).toLocaleString('en-IN')} · {prepared.snapshot.rows.length} entries
              </span>
            )}
          </div>

          <hr className="divider" />

          <div className="row row--between">
            <span className="strong">Things to check</span>
            <span className="pill pill--info">{summary.blockingFindingCount + summary.warningFindingCount}</span>
          </div>

          {prepared.findings.filter((f) => !f.resolved).length === 0 ? (
            <p className="muted small">Nothing to check right now.</p>
          ) : (
            <div className="stack stack--tight">
              {prepared.findings
                .filter((f) => !f.resolved)
                .slice(0, 25)
                .map((f) => (
                  <div key={f.id} className={`notice ${f.severity === 'blocking' ? 'notice--danger' : 'notice--warn'}`}>
                    <span className="notice__icon" aria-hidden="true">{f.severity === 'blocking' ? '!' : '?'}</span>
                    <div className="stack" style={{ gap: 6 }}>
                      <span className="small strong">{f.message}</span>
                      <span className="tiny">{f.whatYouCanDo}</span>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        style={{ alignSelf: 'flex-start', paddingInline: 8 }}
                        disabled={busy}
                        onClick={async () => {
                          const reason = window.prompt('Why are you leaving this as it is? We will record your reason.');
                          if (!reason) return;
                          setBusy(true);
                          const r = await resolveFindingAction(businessId, f.id, reason);
                          setBusy(false);
                          if (r.ok) router.refresh();
                          else setError(r.error);
                        }}
                      >
                        I have checked this
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}

          <hr className="divider" />

          <div className="row row--between">
            <span className="strong">Credit you can claim</span>
            {summary.unreviewedItcCount > 0 && <span className="pill pill--unpaid">{summary.unreviewedItcCount} to decide</span>}
          </div>
          <p className="tiny muted">
            A bill showing up in GSTR-2B does not by itself mean you can claim the credit. We never claim it for you —
            please decide for each bill.
          </p>

          <div className="stack stack--tight">
            {prepared.supplierBills.slice(0, 25).map((b) => (
              <div key={b.id} className="line-item stack stack--tight">
                <div className="row row--between">
                  <span className="small strong truncate">{b.supplierName}</span>
                  <Money paise={b.cgstPaise + b.sgstPaise + b.igstPaise + b.cessPaise} />
                </div>
                <span className="tiny muted">{b.documentNumber} · {b.documentDate}</span>
                {b.reverseCharge && <span className="pill pill--unpaid">You pay this tax yourself</span>}
                <div className="row row--tight">
                  {(['eligible', 'ineligible', 'blocked'] as const).map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      className="btn btn--secondary"
                      style={{ fontSize: '0.8125rem', paddingInline: 10 }}
                      aria-pressed={b.itcEligibility === choice}
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        const eligible = choice === 'eligible';
                        const r = await reviewItcAction(businessId, {
                          billId: b.id,
                          eligibility: choice,
                          eligibleCgstPaise: eligible ? b.cgstPaise : 0,
                          eligibleSgstPaise: eligible ? b.sgstPaise : 0,
                          eligibleIgstPaise: eligible ? b.igstPaise : 0,
                          eligibleCessPaise: eligible ? b.cessPaise : 0,
                          note: null,
                        });
                        setBusy(false);
                        if (r.ok) router.refresh();
                        else setError(r.error);
                      }}
                    >
                      {choice === 'eligible' ? 'Can claim' : choice === 'ineligible' ? 'Cannot claim' : 'Blocked'}
                    </button>
                  ))}
                </div>
                {b.itcEligibility !== 'not-reviewed' && (
                  <span className="tiny muted">Recorded: {b.itcEligibility}</span>
                )}
              </div>
            ))}
            {prepared.supplierBills.length === 0 && <p className="muted small">No purchases recorded for this period.</p>}
          </div>

          <button type="button" className="btn btn--primary btn--block" onClick={() => setStep(3)}>
            Continue
          </button>
        </section>
      )}

      {/* ==================================================== 3. REVIEW GST */}
      {step === 3 && (
        <section className="card stack" aria-labelledby="s3">
          <h3 id="s3">Review GST</h3>

          <div className="totals">
            <div className="totals__row">
              <span className="muted">GST on your sales</span>
              <span className="amount">
                {formatMoneyIndian(gstr3b.outward.cgstPaise + gstr3b.outward.sgstPaise + gstr3b.outward.igstPaise + gstr3b.outward.cessPaise)}
              </span>
            </div>
            <div className="totals__row">
              <span className="muted">Credit you confirmed you can claim</span>
              <span className="amount">
                − {formatMoneyIndian(gstr3b.eligibleItc.cgstPaise + gstr3b.eligibleItc.sgstPaise + gstr3b.eligibleItc.igstPaise + gstr3b.eligibleItc.cessPaise)}
              </span>
            </div>
            <div className="totals__row totals__row--grand">
              <span>Likely to pay</span>
              <span className="amount">{formatMoneyIndian(gstr3b.payableInCash.totalPaise, { withSymbol: true })}</span>
            </div>
          </div>

          {gstr3b.cashFigureIsProvisional && (
            <div className="notice notice--warn">
              <span className="notice__icon" aria-hidden="true">!</span>
              <span className="small">
                This is an estimate. We do not have your credit and cash balances from the GST portal, so the real
                amount may differ. Check on the portal before paying.
              </span>
            </div>
          )}

          <details className="disclosure">
            <summary>See the detail, head by head</summary>
            <div className="disclosure__body table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Line</th>
                    <th scope="col" className="num">CGST</th>
                    <th scope="col" className="num">SGST/UTGST</th>
                    <th scope="col" className="num">IGST</th>
                    <th scope="col" className="num">Cess</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['GST on sales', gstr3b.outward],
                    ['Credit confirmed', gstr3b.eligibleItc],
                    ['Less reversals', gstr3b.reversals],
                    ['Net credit', gstr3b.netItc],
                    ['To pay in cash', gstr3b.payableInCash],
                    ['Credit carried forward', gstr3b.closingCredit],
                  ].map(([label, row]) => (
                    <tr key={label as string}>
                      <td>{label as string}</td>
                      <td className="num">{formatMoneyIndian((row as { cgstPaise: number }).cgstPaise)}</td>
                      <td className="num">{formatMoneyIndian((row as { sgstPaise: number }).sgstPaise)}</td>
                      <td className="num">{formatMoneyIndian((row as { igstPaise: number }).igstPaise)}</td>
                      <td className="num">{formatMoneyIndian((row as { cessPaise: number }).cessPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          {gstr3b.notes.map((n) => (
            <p key={n} className="tiny muted">{n}</p>
          ))}

          <button type="button" className="btn btn--primary btn--block" onClick={() => setStep(4)}>
            Continue
          </button>
        </section>
      )}

      {/* ============================================ 4. FILE OR HAND OVER */}
      {step === 4 && (
        <section className="card stack" aria-labelledby="s4">
          <h3 id="s4">File or hand to your accountant</h3>

          {readiness.blockers.length > 0 ? (
            <div className="stack stack--tight">
              <div className="notice notice--danger">
                <span className="notice__icon" aria-hidden="true">!</span>
                <span className="small strong">
                  This return is not ready. {readiness.blockers.length} thing{readiness.blockers.length === 1 ? '' : 's'} still
                  need{readiness.blockers.length === 1 ? 's' : ''} sorting out.
                </span>
              </div>
              {readiness.blockers.slice(0, 3).map((b) => (
                <div key={b.code} className="notice notice--warn">
                  <span className="notice__icon" aria-hidden="true">•</span>
                  <div className="stack" style={{ gap: 4 }}>
                    <span className="small strong">{b.message}</span>
                    <span className="tiny">{b.whatYouCanDo}</span>
                  </div>
                </div>
              ))}
              {readiness.blockers.length > 3 && (
                <details className="disclosure">
                  <summary>{readiness.blockers.length - 3} more to deal with</summary>
                  <div className="disclosure__body stack stack--tight">
                    {readiness.blockers.slice(3).map((b) => (
                      <div key={b.code} className="notice notice--warn">
                        <span className="notice__icon" aria-hidden="true">•</span>
                        <div className="stack" style={{ gap: 4 }}>
                          <span className="small strong">{b.message}</span>
                          <span className="tiny">{b.whatYouCanDo}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ) : (
            <div className="notice notice--ok">
              <span className="notice__icon" aria-hidden="true">✓</span>
              <span className="small">Everything checks out. You can approve this and take it to the portal.</span>
            </div>
          )}

          {readiness.warnings.length > 0 && (
            <details className="disclosure">
              <summary>
                {readiness.warnings.length} thing{readiness.warnings.length === 1 ? '' : 's'} worth knowing
              </summary>
              <div className="disclosure__body stack stack--tight">
                {readiness.warnings.map((w) => (
                  <div key={w.code} className="notice notice--warn">
                    <span className="notice__icon" aria-hidden="true">?</span>
                    <div className="stack" style={{ gap: 4 }}>
                      <span className="small">{w.message}</span>
                      <span className="tiny">{w.whatYouCanDo}</span>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          <hr className="divider" />

          <h4 style={{ fontSize: '0.9375rem' }}>Download the accountant pack</h4>
          <p className="tiny muted">
            Spreadsheets of your sales, purchases, the checks and the workings. Your accountant does not need an
            account here.
          </p>
          <a
            className="btn btn--secondary btn--block"
            href={`/api/gst/pack?b=${encodeURIComponent(businessId)}&period=${prepared.period}`}
          >
            Download pack
          </a>

          <hr className="divider" />

          <h4 style={{ fontSize: '0.9375rem' }}>Approve for filing</h4>
          <button
            type="button"
            className="btn btn--primary btn--block btn--large"
            disabled={busy || !readiness.ready}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const r = await approveForFilingAction(businessId, prepared.period, 'GSTR-3B');
              setBusy(false);
              if (r.ok) {
                setMessage('Approved. If you change anything after this, you will need to approve it again.');
                router.refresh();
              } else setError(r.error);
            }}
          >
            Approve this return
          </button>

          <div className="notice notice--info">
            <span className="notice__icon" aria-hidden="true">i</span>
            <div className="stack" style={{ gap: 4 }}>
              <span className="small strong">Filing from inside this app is not available yet.</span>
              <span className="tiny">
                {filingCapability.reason ??
                  'Download the pack above and file on the GST portal, or send it to your accountant.'}
              </span>
            </div>
          </div>

          <hr className="divider" />

          <h4 style={{ fontSize: '0.9375rem' }}>Already filed it yourself?</h4>
          <p className="tiny muted">
            Record the acknowledgement number from the portal. We will show it as “reported filed” until it has been
            checked against the portal — we will not claim it is filed on your word alone.
          </p>
          <OwnerEvidence businessId={businessId} period={prepared.period} onDone={() => router.refresh()} />

          <hr className="divider" />
          <p className="tiny muted">
            <strong>Prepared</strong> means we worked the figures out. <strong>Ready</strong> means nothing is
            blocking. <strong>Uploaded</strong> means a file was sent and is being processed. <strong>Filed</strong>{' '}
            means the portal confirmed it with an acknowledgement number. Only the last one means the return is done.
            {filingFrequency === 'quarterly-qrmp' && ' You file every three months, but tax is still payable each month.'}
          </p>
        </section>
      )}
    </div>
  );
}

function OwnerEvidence({
  businessId,
  period,
  onDone,
}: {
  businessId: string;
  period: string;
  onDone: () => void;
}) {
  const [arn, setArn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="stack stack--tight">
      <div className="field">
        <label className="field__label" htmlFor="arn">Acknowledgement number (ARN)</label>
        <input id="arn" className="input" value={arn} onChange={(e) => setArn(e.target.value)} />
      </div>
      {error && <p className="field__error" role="alert">{error}</p>}
      <button
        type="button"
        className="btn btn--secondary"
        disabled={busy || !arn.trim()}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await attachFilingEvidenceAction(businessId, { period, form: 'GSTR-3B', arn, note: null });
          setBusy(false);
          if (r.ok) onDone();
          else setError(r.error);
        }}
      >
        Record it
      </button>
    </div>
  );
}
