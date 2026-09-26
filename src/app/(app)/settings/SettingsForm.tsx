'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { financialYearOf, todayIst } from '@/lib/dates';
import { checkGstin } from '@/lib/gst/gstin';
import { GST_STATES } from '@/lib/gst/state-codes';
import { formatMoneyPlain } from '@/lib/money';
import type { BusinessRecord } from '@/lib/domain/types';
import type { GstRegistrationType } from '@/lib/gst/scenarios';
import type { RulePackAudit } from '@/lib/gst/ruleset';
import { updateBankDetailsAction, updateBusinessAction } from '@/app/actions/business';
import { endServerSession, firebaseAuth } from '@/lib/firebase/client';

const REGISTRATION_OPTIONS: Array<{ key: GstRegistrationType; label: string; hint: string }> = [
  { key: 'not-registered', label: 'Not registered for GST', hint: 'You do not add GST to your bills.' },
  { key: 'regular', label: 'Regular GST', hint: 'You have a GST number and add GST to your bills.' },
  { key: 'composition', label: 'Composition scheme', hint: 'Not supported yet — you can still keep drafts.' },
  { key: 'not-sure', label: 'Not sure', hint: 'You can save drafts, but not issue bills until this is settled.' },
];

export function SettingsForm({
  returnTo,
  business,
  userEmail,
  ruleAudit,
  aiStatus,
  gspMode,
  pdfStatus,
  backgroundWork,
  supported,
  unsupported,
}: {
  /** The bill the owner was interrupted from, if any. */
  returnTo: string | null;
  business: BusinessRecord;
  userEmail: string | null;
  ruleAudit: RulePackAudit;
  aiStatus: { enabled: boolean; llmProvider: string; llmConfigured: boolean; transcriptionProvider: string; transcriptionConfigured: boolean };
  gspMode: string;
  pdfStatus: { ok: boolean; detail: string };
  backgroundWork: boolean;
  supported: string[];
  unsupported: string[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [form, setForm] = useState({
    legalName: business.legalName,
    tradeName: business.tradeName ?? '',
    addressLine1: business.addressLine1 ?? '',
    city: business.city ?? '',
    pincode: business.pincode ?? '',
    stateCode: business.stateCode ?? '',
    phone: business.phone ?? '',
    email: business.email ?? '',
    registrationType: business.registrationType,
    gstin: business.gstin ?? '',
    pan: business.pan ?? '',
    declaredAggregateTurnover:
      business.declaredAggregateTurnoverPaise !== null ? formatMoneyPlain(business.declaredAggregateTurnoverPaise) : '',
    eInvoicingSelfDeclaredNotApplicable: business.eInvoicingSelfDeclaredNotApplicable,
    issuesInvoicesElsewhere: business.issuesInvoicesElsewhere,
  });

  const [numbering, setNumbering] = useState(business.numbering);

  const [bank, setBank] = useState({
    accountHolderName: business.bank.accountHolderName ?? '',
    accountNumber: business.bank.accountNumber ?? '',
    ifsc: business.bank.ifsc ?? '',
    bankName: business.bank.bankName ?? '',
    upiId: business.bank.upiId ?? '',
  });
  const [bankPassword, setBankPassword] = useState('');
  const [bankConfirming, setBankConfirming] = useState(false);

  async function save(section: string, patch: Record<string, unknown>) {
    setSaving(section);
    setError(null);
    setSaved(null);
    const r = await updateBusinessAction(business.id, patch);
    setSaving(null);
    if (r.ok) {
      setSaved(section);
      router.refresh();
    } else {
      setError(r.error);
    }
  }

  const gstinCheck = form.gstin.length === 15 ? checkGstin(form.gstin) : null;

  return (
    <div className="stack stack--loose">
      {returnTo && (
        <a className="btn btn--secondary btn--block" href={returnTo}>
          ← Back to your bill
        </a>
      )}
      {error && (
        <div className="notice notice--danger" role="alert">
          <span className="notice__icon" aria-hidden="true">!</span>
          <span>{error}</span>
        </div>
      )}

      {/* Four settings cards, each about one thing. On a phone they stack; in
          a browser window they sit two across, which turns a 2,300px scroll
          into one screen. The reference material below stays full width. */}
      <div className="deck">
      {/* ---------------------------------------------------------- identity */}
      <section className="card stack" aria-labelledby="s-identity">
        <h2 id="s-identity">Your business</h2>

        <div className="field">
          <label className="field__label" htmlFor="legalName">Business name</label>
          <input id="legalName" className="input" value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
          <span className="field__hint">This is printed on your bills.</span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="addr">Address</label>
          <input id="addr" className="input" value={form.addressLine1} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
        </div>

        <div className="line-item__grid">
          <div className="field">
            <label className="field__label" htmlFor="city">Town or city</label>
            <input id="city" className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="pin">PIN code</label>
            <input id="pin" className="input" inputMode="numeric" maxLength={6} value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} />
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="state">State</label>
          <select id="state" className="select" value={form.stateCode} onChange={(e) => setForm({ ...form, stateCode: e.target.value })}>
            <option value="">Choose your state</option>
            {GST_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </div>

        <details className="disclosure">
          <summary>Contact details</summary>
          <div className="disclosure__body stack">
            <div className="field">
              <label className="field__label" htmlFor="phone">Phone</label>
              <input id="phone" className="input" type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="bemail">Email</label>
              <input id="bemail" className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
        </details>

        <button
          type="button"
          className="btn btn--primary btn--block"
          disabled={saving !== null}
          onClick={() =>
            void save('identity', {
              legalName: form.legalName,
              tradeName: form.tradeName,
              addressLine1: form.addressLine1,
              city: form.city,
              pincode: form.pincode,
              stateCode: form.stateCode || null,
              phone: form.phone,
              email: form.email,
            })
          }
        >
          {saving === 'identity' ? 'Saving…' : saved === 'identity' ? 'Saved ✓' : 'Save'}
        </button>
      </section>

      {/* --------------------------------------------------------------- GST */}
      <section className="card stack" aria-labelledby="s-gst">
        <h2 id="s-gst">GST status</h2>
        <p className="muted small">We need this before you can issue your first bill, so the bill is correct.</p>

        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="sr-only">Your GST registration</legend>
          {REGISTRATION_OPTIONS.map((opt) => (
            <label key={opt.key} className="checkbox-row">
              <input
                type="radio"
                name="registrationType"
                checked={form.registrationType === opt.key}
                onChange={() => setForm({ ...form, registrationType: opt.key })}
              />
              <span className="stack" style={{ gap: 2 }}>
                <span className="strong">{opt.label}</span>
                <span className="tiny muted">{opt.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {form.registrationType === 'regular' && (
          <>
            <div className="field">
              <label className="field__label" htmlFor="gstin">Your GST number</label>
              <input
                id="gstin"
                className="input"
                maxLength={15}
                style={{ textTransform: 'uppercase' }}
                value={form.gstin}
                onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
                aria-invalid={gstinCheck ? !gstinCheck.ok : undefined}
              />
              {gstinCheck && (
                <span className={gstinCheck.ok ? 'field__hint' : 'field__error'}>
                  {gstinCheck.ok ? `Format looks right — ${gstinCheck.stateName}. We cannot confirm it is active.` : gstinCheck.message}
                </span>
              )}
            </div>

            <div className="field">
              <label className="field__label" htmlFor="turnover">Your yearly sales (₹)</label>
              <input
                id="turnover"
                className="input input--numeric"
                inputMode="decimal"
                value={form.declaredAggregateTurnover}
                onChange={(e) => setForm({ ...form, declaredAggregateTurnover: e.target.value })}
              />
              <span className="field__hint">Used only to check one GST rule for you. It is never shown on a bill.</span>
            </div>

            <div className="notice notice--warn">
              <span className="notice__icon" aria-hidden="true">!</span>
              <div className="stack" style={{ gap: 6 }}>
                <span className="small">
                  Some GST-registered businesses must create their bills through the government e-invoice system.
                  We could not check this for you automatically, so please confirm with your accountant.
                </span>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.eInvoicingSelfDeclaredNotApplicable}
                    onChange={(e) => setForm({ ...form, eInvoicingSelfDeclaredNotApplicable: e.target.checked })}
                  />
                  <span className="small">
                    I have checked, and the government e-invoice system does not apply to my business.
                  </span>
                </label>
              </div>
            </div>
          </>
        )}

        <details className="disclosure">
          <summary>PAN (optional)</summary>
          <div className="disclosure__body">
            <div className="field">
              <label className="field__label" htmlFor="pan">PAN</label>
              <input id="pan" className="input" maxLength={10} style={{ textTransform: 'uppercase' }} value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} />
            </div>
          </div>
        </details>

        <button
          type="button"
          className="btn btn--primary btn--block"
          disabled={saving !== null}
          onClick={() =>
            void save('gst', {
              registrationType: form.registrationType,
              gstin: form.registrationType === 'regular' ? form.gstin : null,
              pan: form.pan,
              declaredAggregateTurnover: form.declaredAggregateTurnover || null,
              eInvoicingSelfDeclaredNotApplicable: form.eInvoicingSelfDeclaredNotApplicable,
            })
          }
        >
          {saving === 'gst' ? 'Saving…' : saved === 'gst' ? 'Saved ✓' : 'Save GST status'}
        </button>
      </section>

      {/* ---------------------------------------------------------- numbering */}
      <section className="card stack" aria-labelledby="s-numbering">
        <h2 id="s-numbering">Bill numbers</h2>
        <p className="muted small">
          Your bills are numbered in order and restart each financial year. Set this before your first bill so your
          numbers do not clash with bills you raised elsewhere.
        </p>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.issuesInvoicesElsewhere === true}
            onChange={(e) => setForm({ ...form, issuesInvoicesElsewhere: e.target.checked })}
          />
          <span className="small">I already issue bills somewhere else this year</span>
        </label>

        <div className="line-item__grid">
          <div className="field">
            <label className="field__label" htmlFor="prefix">Prefix</label>
            <input id="prefix" className="input" maxLength={10} value={numbering.prefix} onChange={(e) => setNumbering({ ...numbering, prefix: e.target.value })} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="startNo">Start from</label>
            <input
              id="startNo"
              className="input input--numeric"
              inputMode="numeric"
              value={String(numbering.nextNumber)}
              onChange={(e) => setNumbering({ ...numbering, nextNumber: Number(e.target.value.replace(/\D/g, '')) || 1 })}
            />
          </div>
        </div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={numbering.includeFinancialYear}
            onChange={(e) => setNumbering({ ...numbering, includeFinancialYear: e.target.checked })}
          />
          <span className="small">Include the financial year in the number</span>
        </label>

        <p className="small">
          Your next bill will be numbered{' '}
          <span className="strong">
            {numbering.prefix}
            {numbering.includeFinancialYear ? `${business.activeFinancialYear}/` : ''}
            {String(numbering.nextNumber).padStart(numbering.padding, '0')}
          </span>
        </p>

        <p className="tiny muted">
          Financial year {business.activeFinancialYear} (currently {financialYearOf(todayIst())}).
        </p>

        <button
          type="button"
          className="btn btn--primary btn--block"
          disabled={saving !== null}
          onClick={() => void save('numbering', { numbering, issuesInvoicesElsewhere: form.issuesInvoicesElsewhere })}
        >
          {saving === 'numbering' ? 'Saving…' : saved === 'numbering' ? 'Saved ✓' : 'Save numbering'}
        </button>
      </section>

      {/* --------------------------------------------------------------- bank */}
      <section className="card stack" aria-labelledby="s-bank">
        <h2 id="s-bank">How customers pay you</h2>
        <p className="muted small">
          These appear on your bills so customers know where to send money. Check them carefully — a wrong detail sends
          your customer&rsquo;s money to someone else.
        </p>

        <div className="field">
          <label className="field__label" htmlFor="upi">UPI ID</label>
          <input id="upi" className="input" value={bank.upiId} onChange={(e) => setBank({ ...bank, upiId: e.target.value })} placeholder="yourname@bank" />
        </div>

        <details className="disclosure">
          <summary>Bank account details</summary>
          <div className="disclosure__body stack">
            <div className="field">
              <label className="field__label" htmlFor="acName">Account holder name</label>
              <input id="acName" className="input" value={bank.accountHolderName} onChange={(e) => setBank({ ...bank, accountHolderName: e.target.value })} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="acNo">Account number</label>
              <input id="acNo" className="input" inputMode="numeric" value={bank.accountNumber} onChange={(e) => setBank({ ...bank, accountNumber: e.target.value })} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="ifsc">IFSC</label>
              <input id="ifsc" className="input" maxLength={11} style={{ textTransform: 'uppercase' }} value={bank.ifsc} onChange={(e) => setBank({ ...bank, ifsc: e.target.value.toUpperCase() })} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="bankName">Bank name</label>
              <input id="bankName" className="input" value={bank.bankName} onChange={(e) => setBank({ ...bank, bankName: e.target.value })} />
            </div>
          </div>
        </details>

        {!bankConfirming ? (
          <button type="button" className="btn btn--secondary btn--block" onClick={() => setBankConfirming(true)}>
            Save payment details
          </button>
        ) : (
          <div className="stack">
            <div className="notice notice--warn">
              <span className="notice__icon" aria-hidden="true">🔒</span>
              <span className="small">
                Because this changes where your money is sent, please confirm your password.
              </span>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="confirmPw">Your password</label>
              <input id="confirmPw" className="input" type="password" autoComplete="current-password" value={bankPassword} onChange={(e) => setBankPassword(e.target.value)} />
            </div>
            <div className="row row--tight">
              <button
                type="button"
                className="btn btn--primary grow"
                disabled={saving !== null || !bankPassword}
                onClick={async () => {
                  setSaving('bank');
                  setError(null);
                  try {
                    // Re-authenticate with the managed provider, then pass the
                    // moment it happened to the server, which refuses a stale one.
                    const { EmailAuthProvider, reauthenticateWithCredential } = await import('firebase/auth');
                    const auth = firebaseAuth();
                    if (!auth.currentUser?.email) throw new Error('Please sign in again.');
                    const credential = EmailAuthProvider.credential(auth.currentUser.email, bankPassword);
                    await reauthenticateWithCredential(auth.currentUser, credential);

                    const r = await updateBankDetailsAction(business.id, bank, { reauthenticatedAt: Date.now() });
                    if (r.ok) {
                      setSaved('bank');
                      setBankConfirming(false);
                      setBankPassword('');
                      router.refresh();
                    } else setError(r.error);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Could not confirm your password.');
                  } finally {
                    setSaving(null);
                  }
                }}
              >
                {saving === 'bank' ? 'Saving…' : 'Confirm and save'}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => { setBankConfirming(false); setBankPassword(''); }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------ what we support */}
      <details className="card disclosure deck__full">
        <summary>What this app can and cannot handle</summary>
        <div className="disclosure__body stack">
          <div className="stack stack--tight">
            <span className="field__label">Supported</span>
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              {supported.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </div>
          <div className="stack stack--tight">
            <span className="field__label">Not supported yet</span>
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              {unsupported.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </div>
          <p className="tiny muted">
            We do not make a blanket claim that every bill is GST compliant. Where we cannot be sure, we say so and
            stop, rather than issuing a document that might be wrong.
          </p>
          {!backgroundWork && (
            <div className="notice notice--warn">
              <span className="notice__icon" aria-hidden="true">!</span>
              <span className="small">
                Monthly bills will not be prepared automatically on this installation. You can still create every
                bill yourself, and nothing already saved is affected. Whoever looks after this app for you needs to
                finish setting up the background worker.
              </span>
            </div>
          )}
          {!pdfStatus.ok && (
            <div className="notice notice--danger">
              <span className="notice__icon" aria-hidden="true">!</span>
              <span className="small">
                Bill PDFs cannot be produced on this installation, so sharing a bill with a customer will not
                work. Everything else is unaffected — your bills are saved and their figures are correct.
                Whoever looks after this app for you needs to fix the installation.
              </span>
            </div>
          )}
          {!ruleAudit.fullyVerified && (
            <div className="notice notice--warn">
              <span className="notice__icon" aria-hidden="true">!</span>
              <span className="small">
                {ruleAudit.unverified.length} tax {ruleAudit.unverified.length === 1 ? 'rule has' : 'rules have'} not been
                checked against the official source yet. Anything that depends on them is switched off rather than
                guessed at. Whoever looks after this app for you can finish that off.
              </span>
            </div>
          )}
        </div>
      </details>

      {/* ------------------------------------------------------------- status */}
      <details className="card disclosure deck__full">
        <summary>App status</summary>
        <div className="disclosure__body stack stack--tight small">
          <div className="row row--between"><span className="muted">Signed in as</span><span className="truncate">{userEmail ?? '—'}</span></div>
          <div className="row row--between"><span className="muted">Assistant</span><span>{aiStatus.enabled ? `${aiStatus.llmProvider}${aiStatus.llmConfigured ? '' : ' (not configured)'}` : 'off'}</span></div>
          <div className="row row--between"><span className="muted">Voice</span><span>{aiStatus.transcriptionProvider}{aiStatus.transcriptionConfigured ? '' : ' (not configured)'}</span></div>
          <div className="row row--between"><span className="muted">GST filing</span><span>{gspMode}</span></div>
          <div className="row row--between">
            <span className="muted">Monthly drafts</span>
            <span style={backgroundWork ? undefined : { color: 'var(--warn)', fontWeight: 650 }}>
              {backgroundWork ? 'ready' : 'not configured'}
            </span>
          </div>
          <div className="row row--between">
            <span className="muted">Bill PDFs</span>
            <span style={pdfStatus.ok ? undefined : { color: 'var(--danger)', fontWeight: 650 }}>
              {pdfStatus.detail}
            </span>
          </div>
          <div className="row row--between"><span className="muted">Tax rules</span><span>{ruleAudit.verified}/{ruleAudit.total} confirmed</span></div>
        </div>
      </details>

      <button
        type="button"
        className="btn btn--secondary btn--block deck__full"
        onClick={async () => {
          // Clear any locally cached drafts so a shared device does not leak them.
          try {
            for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
              const key = window.localStorage.key(i);
              if (key?.startsWith('eb:draft:')) window.localStorage.removeItem(key);
            }
          } catch { /* ignore */ }
          await endServerSession();
          router.replace('/signin');
        }}
      >
        Sign out
      </button>
      </div>
    </div>
  );
}
