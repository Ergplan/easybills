'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { formatDateShort, todayIst } from '@/lib/dates';
import { formatMoneyIndian, formatPercentPlain } from '@/lib/money';
import { GST_STATES } from '@/lib/gst/state-codes';
import { SUPPLY_FLAG_LABELS, type SupplyFlag } from '@/lib/gst/scenarios';
import { saveDraftAction, priceDraftAction, issueInvoiceAction, saveItemForNextTimeAction } from '@/app/actions/invoices';

import { CustomerPicker } from './CustomerPicker';
import { LineItems } from './LineItems';
import { ReviewPanel } from './ReviewPanel';
import { AiInstructionBox } from './AiInstructionBox';
import { readLocalDraft, saveStateLabel, useAutosave } from './useAutosave';
import { emptyLine, type EditorBootstrap, type EditorState, type LineDraft } from './types';

function toEditorState(b: EditorBootstrap): EditorState {
  const inv = b.invoice;
  return {
    kind: inv.kind,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    paymentTermsDays: inv.paymentTermsDays,
    customer: {
      customerId: inv.customer.customerId,
      name: inv.customer.name,
      phone: inv.customer.phone ?? '',
      email: inv.customer.email ?? '',
      addressLine1: inv.customer.addressLine1 ?? '',
      city: inv.customer.city ?? '',
      pincode: inv.customer.pincode ?? '',
      stateCode: inv.customer.stateCode ?? '',
      gstin: inv.customer.gstin ?? '',
      pan: inv.customer.pan ?? '',
    },
    placeOfSupplyStateCode: inv.placeOfSupplyStateCode ?? b.sellerStateCode ?? '',
    supplyFlags: inv.supplyFlags,
    lines: inv.lines.length
      ? inv.lines.map((l) => ({
          id: l.id,
          description: l.description,
          quantity: String(l.quantityMilli / 1000),
          unitPrice: l.unitPricePaise ? (l.unitPricePaise / 100).toFixed(2) : '',
          discount: l.discountPaise ? (l.discountPaise / 100).toFixed(2) : '',
          // A deliberate 0% must come back as 0%, not as an empty select --
          // the rate is zero either way, so only the flag can tell them apart.
          taxRate: l.taxRateChosen ? formatPercentPlain(l.taxRateBp) : '',
          unit: l.unit ?? '',
          hsnCode: l.hsnCode ?? '',
          priceIncludesTax: l.priceIncludesTax,
          savedItemId: l.savedItemId,
          saveForNextTime: false,
        }))
      : [emptyLine()],
    notes: inv.notes ?? '',
    revision: inv.revision,
  };
}

/** Shape the server action expects. Money stays a string until the server parses it. */
function toPayload(state: EditorState, invoiceId: string) {
  return {
    invoiceId,
    kind: state.kind,
    issueDate: state.issueDate,
    dueDate: state.dueDate,
    paymentTermsDays: state.paymentTermsDays,
    customer: {
      customerId: state.customer.customerId,
      name: state.customer.name.trim() || 'Walk-in customer',
      phone: state.customer.phone,
      email: state.customer.email,
      addressLine1: state.customer.addressLine1,
      addressLine2: null,
      city: state.customer.city,
      pincode: state.customer.pincode,
      stateCode: state.customer.stateCode || null,
      gstin: state.customer.gstin,
      pan: state.customer.pan,
    },
    placeOfSupplyStateCode: state.placeOfSupplyStateCode || null,
    supplyFlags: state.supplyFlags,
    lines: state.lines
      .filter((l) => l.description.trim() !== '' || l.unitPrice.trim() !== '')
      .map((l) => ({
        id: l.id,
        description: l.description.trim() || 'Item',
        quantityMilli: l.quantity || '1',
        unitPricePaise: l.unitPrice || '0',
        discountPaise: l.discount || '0',
        // Sent empty when unanswered. The server prices it as zero either way,
        // but records that nobody chose it and refuses to issue on that basis.
        taxRateBp: l.taxRate,
        cessRateBp: '0',
        priceIncludesTax: l.priceIncludesTax,
        unit: l.unit || null,
        hsnCode: l.hsnCode || null,
        savedItemId: l.savedItemId,
      })),
    notes: state.notes || null,
    baseRevision: state.revision,
  };
}

export function InvoiceEditor({ bootstrap }: { bootstrap: EditorBootstrap }) {
  const router = useRouter();
  const [state, setState] = useState<EditorState>(() => toEditorState(bootstrap));
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<Array<{ code: string; message: string; whatYouCanDo: string }>>([]);
  const [recovered, setRecovered] = useState<{ at: number } | null>(null);
  // While the assistant is asking which customer was meant, the customer
  // section hides its own list so the same names are not offered twice.
  const [awaitingCustomerChoice, setAwaitingCustomerChoice] = useState(false);

  const invoiceId = bootstrap.invoice.id;
  const localKey = `eb:draft:${bootstrap.businessId}:${invoiceId}`;

  const payload = useMemo(() => toPayload(state, invoiceId), [state, invoiceId]);

  const { state: saveState, saveNow } = useAutosave<EditorState>({
    value: state,
    localKey,
    save: async (v) => {
      const result = await saveDraftAction(bootstrap.businessId, toPayload(v, invoiceId));
      if (result.ok) {
        // Track the revision the server now holds, so the next save is not stale.
        setState((prev) => (prev.revision === v.revision ? { ...prev, revision: result.data.invoice.revision } : prev));
        return { ok: true as const, revision: result.data.invoice.revision };
      }
      return {
        ok: false as const,
        conflictRevision: result.code === 'conflict' ? result.currentRevision : undefined,
        message: result.error,
      };
    },
  });

  // Offer to restore a local copy left behind by a closed tab on this device.
  //
  // After hydration, not during render: local storage does not exist on the
  // server, so deciding this while rendering makes the first client markup
  // differ from the server's and React throws the whole tree away.
  useEffect(() => {
    const local = readLocalDraft<EditorState>(localKey);
    if (local && local.at > new Date(bootstrap.invoice.updatedAt).getTime() + 1000) {
      setRecovered({ at: local.at });
    }
  }, [localKey, bootstrap.invoice.updatedAt]);

  const update = useCallback(<K extends keyof EditorState>(key: K, value: EditorState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const setLines = useCallback((lines: LineDraft[]) => setState((prev) => ({ ...prev, lines })), []);

  const [priced, setPriced] = useState<Awaited<ReturnType<typeof priceDraftAction>> | null>(null);

  const goReview = useCallback(async () => {
    setIssueError(null);
    setBlockers([]);

    // Caught here, when the owner asks to review -- not while they are still
    // filling the form in.
    if (!payload.lines.length) {
      setIssueError('Add at least one item before you review this bill.');
      return;
    }

    await saveNow();
    const result = await priceDraftAction(bootstrap.businessId, payload);
    setPriced(result);
    if (result.ok) {
      setBlockers(result.data.assessment.blockers);
      setStep('review');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      setIssueError(result.error);
    }
  }, [bootstrap.businessId, payload, saveNow]);

  const doIssue = useCallback(async () => {
    setIssuing(true);
    setIssueError(null);
    try {
      // Persist any last edit before committing, then issue by id. The server
      // re-prices and re-assesses inside the transaction regardless.
      await saveNow();
      const result = await issueInvoiceAction(bootstrap.businessId, invoiceId);
      if (result.ok) {
        // Save any items the owner explicitly asked to keep -- only those.
        await Promise.all(
          state.lines
            .filter((l) => l.saveForNextTime && l.description.trim())
            .map((l) =>
              saveItemForNextTimeAction(bootstrap.businessId, {
                description: l.description.trim(),
                unitPricePaise: Math.round(Number(l.unitPrice || 0) * 100),
                unit: l.unit || null,
                taxRateBp: l.taxRate ? Math.round(Number(l.taxRate) * 100) : null,
                hsnCode: l.hsnCode || null,
              }),
            ),
        );
        try {
          window.localStorage.removeItem(localKey);
        } catch { /* ignore */ }
        router.replace(`/bills/${invoiceId}`);
        router.refresh();
      } else {
        setIssueError(result.error);
        setBlockers(result.blockers ?? []);
      }
    } finally {
      setIssuing(false);
    }
  }, [bootstrap.businessId, invoiceId, localKey, router, saveNow, state.lines]);

  const defaultRate = bootstrap.defaultTaxRateBp ? formatPercentPlain(bootstrap.defaultTaxRateBp) : '';
  const label = saveStateLabel(saveState);
  const isQuickBill = state.kind === 'quick-bill';

  const estimatedTotal = useMemo(() => {
    // A local estimate for the sticky bar only. The figure the owner commits to
    // is always the server's, shown on the review screen.
    let total = 0;
    for (const l of state.lines) {
      const qty = Number(l.quantity || '1');
      const price = Number(l.unitPrice || '0');
      const disc = Number(l.discount || '0');
      const rate = Number(l.taxRate || '0');
      if (!Number.isFinite(qty) || !Number.isFinite(price)) continue;
      const net = Math.max(0, qty * price - (Number.isFinite(disc) ? disc : 0));
      const base = l.priceIncludesTax ? net : net + (bootstrap.chargesGst ? (net * rate) / 100 : 0);
      total += base;
    }
    return Math.round(total * 100);
  }, [state.lines, bootstrap.chargesGst]);

  if (step === 'review' && priced?.ok) {
    return (
      <ReviewPanel
        priced={priced.data}
        state={state}
        blockers={blockers}
        issuing={issuing}
        error={issueError}
        onBack={() => setStep('edit')}
        onIssue={doIssue}
      />
    );
  }

  return (
    <div className="editor-layout">
      <div className="stack editor-with-sticky">
        {recovered && (
          <div className="notice notice--warn" role="status">
            <span className="notice__icon" aria-hidden="true">!</span>
            <div className="stack" style={{ gap: 6 }}>
              <span>
                There is a newer copy of this bill saved on this device from{' '}
                {new Date(recovered.at).toLocaleString('en-IN')}.
              </span>
              <div className="row row--tight">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => {
                    const local = readLocalDraft<EditorState>(localKey);
                    if (local) setState({ ...local.value, revision: state.revision });
                    setRecovered(null);
                  }}
                >
                  Use the device copy
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setRecovered(null)}>
                  Keep this one
                </button>
              </div>
            </div>
          </div>
        )}

        {bootstrap.setupBlockers.length > 0 && (
          <div className="notice notice--warn" role="status">
            <span className="notice__icon" aria-hidden="true">!</span>
            <div className="stack" style={{ gap: 6 }}>
              <span className="strong">{bootstrap.setupBlockers[0]!.message}</span>
              <span className="small">{bootstrap.setupBlockers[0]!.whatYouCanDo}</span>
              <span className="tiny">
                You can carry on filling this bill in — it will be saved. You just cannot issue it yet.
              </span>
              <a
                className="btn btn--secondary"
                style={{ alignSelf: 'flex-start' }}
                href={`/settings?next=${encodeURIComponent(`/bills/${invoiceId}`)}`}
              >
                Sort this out now
              </a>
            </div>
          </div>
        )}

        {bootstrap.aiEnabled && (
          <AiInstructionBox
            businessId={bootstrap.businessId}
            invoiceId={invoiceId}
            onDisambiguating={setAwaitingCustomerChoice}
            onProposal={(proposal) => {
              // AI proposes; the owner reviews. Existing typing is preserved --
              // proposed lines are appended, never a silent replacement.
              setState((prev) => {
                const kept = prev.lines.filter((l) => l.description.trim() || l.unitPrice.trim());
                const merged = [...kept, ...proposal.lines];
                return {
                  ...prev,
                  customer: proposal.customer ? { ...prev.customer, ...proposal.customer } : prev.customer,
                  // Never leave the form with nothing to type into. If the
                  // assistant understood nothing and the form was empty, the
                  // owner still needs a row to fill in by hand.
                  lines: merged.length ? merged : [emptyLine(defaultRate)],
                };
              });
            }}
          />
        )}

        {/* ---------------------------------------------------------- customer */}
        <section className="card stack" aria-labelledby="customer-heading">
          <h2 id="customer-heading">{isQuickBill ? 'Customer (optional)' : 'Customer'}</h2>
          <CustomerPicker
            businessId={bootstrap.businessId}
            isQuickBill={isQuickBill}
            suppressList={awaitingCustomerChoice}
            recent={bootstrap.recentCustomers}
            value={state.customer}
            chargesGst={bootstrap.chargesGst}
            onChange={(customer) => {
              setState((prev) => ({
                ...prev,
                customer,
                // Default the place of supply from the customer's state, but the
                // owner still confirms it below -- an address is not a tax rule.
                placeOfSupplyStateCode: customer.stateCode || prev.placeOfSupplyStateCode,
              }));
            }}
          />
        </section>

        {/* ------------------------------------------------------------- items */}
        <section className="card stack" aria-labelledby="items-heading">
          <h2 id="items-heading">Items</h2>
          <LineItems
            lines={state.lines}
            savedItems={bootstrap.savedItems}
            chargesGst={bootstrap.chargesGst}
            selectableRatesBp={bootstrap.selectableRatesBp}
            defaultTaxRateBp={bootstrap.defaultTaxRateBp}
            onChange={setLines}
          />
        </section>

        {/* ----------------------------------------------- confirm place of supply */}
        {bootstrap.chargesGst && (
          <section className="card stack" aria-labelledby="pos-heading">
            <h2 id="pos-heading">Where is this supply for?</h2>
            <p className="faint">
              This decides which GST applies. We have suggested one from the customer&rsquo;s details — please
              confirm it is right.
            </p>
            <div className="field">
              <label className="field__label" htmlFor="pos">State of supply</label>
              <select
                id="pos"
                className="select"
                value={state.placeOfSupplyStateCode}
                onChange={(e) => update('placeOfSupplyStateCode', e.target.value)}
              >
                <option value="">Choose a state</option>
                {GST_STATES.map((s) => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
            </div>
          </section>
        )}

        {/* ------------------------------------------------------ more options */}
        <details className="card disclosure">
          <summary>More options</summary>
          <div className="disclosure__body stack">
            <div className="field">
              <label className="field__label" htmlFor="issue-date">Bill date</label>
              <input
                id="issue-date"
                className="input"
                type="date"
                value={state.issueDate}
                max={todayIst()}
                onChange={(e) => update('issueDate', e.target.value)}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="terms">Payment due</label>
              <select
                id="terms"
                className="select"
                value={state.paymentTermsDays ?? ''}
                onChange={(e) => update('paymentTermsDays', e.target.value === '' ? null : Number(e.target.value))}
              >
                <option value="0">Straight away</option>
                <option value="7">In 7 days</option>
                <option value="15">In 15 days</option>
                <option value="30">In 30 days</option>
                <option value="">No due date</option>
              </select>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="notes">Note on the bill</label>
              <textarea
                id="notes"
                className="textarea"
                value={state.notes}
                maxLength={2000}
                onChange={(e) => update('notes', e.target.value)}
                placeholder="Anything the customer should see"
              />
            </div>

            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field__label" style={{ padding: 0 }}>Is this bill any of these?</legend>
              <p className="field__hint" style={{ marginBottom: 4 }}>
                Most bills are none of these. Tick one only if it applies — we cannot issue these kinds of bill yet,
                but your draft stays saved.
              </p>
              {(Object.keys(SUPPLY_FLAG_LABELS) as SupplyFlag[]).map((flag) => (
                <label key={flag} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={state.supplyFlags.includes(flag)}
                    onChange={(e) =>
                      update(
                        'supplyFlags',
                        e.target.checked ? [...state.supplyFlags, flag] : state.supplyFlags.filter((f) => f !== flag),
                      )
                    }
                  />
                  <span className="small">{SUPPLY_FLAG_LABELS[flag]}</span>
                </label>
              ))}
            </fieldset>
          </div>
        </details>

        {issueError && (
          <div className="notice notice--danger" role="alert">
            <span className="notice__icon" aria-hidden="true">!</span>
            <span>{issueError}</span>
          </div>
        )}
      </div>

      {/* Desktop live preview. Hidden below 900px, where the sticky bar leads instead. */}
      <aside className="editor-preview card stack" aria-label="Preview">
        <span className="pill pill--draft">DRAFT — not issued</span>
        <h3>{state.customer.name || 'Walk-in customer'}</h3>
        <p className="faint">{formatDateShort(state.issueDate)}</p>
        <hr className="divider" />
        <div className="stack stack--tight">
          {state.lines
            .filter((l) => l.description.trim())
            .map((l) => (
              <div key={l.id} className="row row--between small">
                <span className="grow truncate">{l.description}</span>
                <span className="amount">
                  {l.quantity} × {formatMoneyIndian(Math.round(Number(l.unitPrice || 0) * 100))}
                </span>
              </div>
            ))}
        </div>
        <hr className="divider" />
        <div className="row row--between">
          <span className="strong">Total (estimate)</span>
          <span className="amount">{formatMoneyIndian(estimatedTotal, { withSymbol: true })}</span>
        </div>
        <p className="tiny muted">The final figure is calculated and confirmed on the review screen.</p>
      </aside>

      {/* Sticky total + review. Always reachable with one thumb. */}
      <div className="sticky-total">
        <div className="sticky-total__inner">
          <div className="grow stack" style={{ gap: 2 }}>
            <span className="tiny muted">Total</span>
            <span className="amount" style={{ fontSize: '1.25rem' }}>
              {formatMoneyIndian(estimatedTotal, { withSymbol: true })}
            </span>
            <span className={label.className} aria-live="polite">{label.text}</span>
          </div>
          <button type="button" className="btn btn--primary btn--large" onClick={() => void goReview()}>
            Review
          </button>
        </div>
      </div>
    </div>
  );
}
