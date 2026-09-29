'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { saveAapAction } from '@/app/actions/business';
import { BillLookSection } from '@/components/aap/BillLookSection';
import { t } from '@/lib/copy';
import { PAYMENT_TERMS, parseAap, type AapField, type AapInput } from '@/lib/domain/aap';
import { previewNumber } from '@/lib/domain/bill-guard';
import { DEFAULT_LOOK } from '@/lib/domain/bill-look';
import { formatPhone } from '@/lib/domain/profile';
import type { FinancialYear } from '@/lib/dates';
import { GST_STATES } from '@/lib/gst/state-codes';

export interface AppInfo {
  signInOn: boolean;
  pdf: 'on' | 'broken';
  voice: 'on' | 'off';
  photos: 'on' | 'off' | 'broken';
}

/**
 * "Aap": the shop, GST, how customers pay, bill numbers and payment terms,
 * as sections of one form with one Save that stays at the bottom of the
 * screen. It replaces the old English settings page.
 */
export function AapForm({
  businessId,
  phone,
  initial,
  minNextNumber,
  fy,
  padding,
  info,
}: {
  businessId: string;
  phone: string | null;
  initial: AapInput;
  minNextNumber: number;
  fy: FinancialYear;
  padding: number;
  info: AppInfo;
}) {
  const router = useRouter();
  const [form, setForm] = useState<AapInput>({ ...initial, phone: phone ?? initial.phone });
  const [problem, setProblem] = useState<{ field: AapField; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tourNote, setTourNote] = useState(false);

  const update = (patch: Partial<AapInput>, field?: AapField) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
    setSaved(null);
    if (!field || problem?.field === field || (field === 'gstin' && problem?.field === 'stateCode')) setProblem(null);
  };
  const text = (field: AapField & keyof AapInput, transform?: (v: string) => string) => ({
    value: String(form[field] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      update({ [field]: transform ? transform(e.target.value) : e.target.value } as Partial<AapInput>, field),
  });
  const errorFor = (field: AapField) => (problem?.field === field ? problem.message : null);
  const preview = useMemo(
    () =>
      previewNumber(
        { prefix: form.prefix, nextNumber: Number(form.nextNumber) || minNextNumber, padding, includeFinancialYear: form.includeFinancialYear },
        fy,
      ),
    [form.prefix, form.nextNumber, form.includeFinancialYear, padding, fy, minNextNumber],
  );

  async function save() {
    const checked = parseAap(form, { minNextNumber });
    if (!checked.ok) {
      setProblem({ field: checked.field, message: checked.message });
      const id =
        checked.field === 'prefix' ? 'num-prefix' : checked.field === 'nextNumber' ? 'num-next' : checked.field === 'logoDataUrl' ? 'you-logo' : `you-${checked.field}`;
      document.getElementById(id)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const r = await saveAapAction(businessId, form);
    setBusy(false);
    if (r.ok) {
      setDirty(false);
      setSaved(t('num.saved', { preview: r.data.preview }));
      router.refresh();
      return;
    }
    if ('field' in r) setProblem({ field: r.field, message: r.error });
    else setError(r.error);
  }

  return (
    <form
      className="stack aap"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <section className="card stack">
        <h2 className="card__title">{t('aap.shop')}</h2>
        <Field id="you-name" label={t('you.name')} hint={t('you.nameHint')} error={errorFor('name')}>
          <input id="you-name" className="input" maxLength={120} {...text('name')} />
        </Field>
        <Field id="you-phone" label={t('you.phone')} hint={t('you.phoneHint')} error={errorFor('phone')}>
          {phone ? (
            <input id="you-phone" className="input" value={formatPhone(phone)} readOnly />
          ) : (
            <input id="you-phone" className="input" type="tel" inputMode="tel" maxLength={16} {...text('phone')} />
          )}
        </Field>
        <Field id="you-addressLine1" label={`${t('aap.address')} · ${t('common.optional')}`} hint={t('aap.addressHint')} error={errorFor('addressLine1')}>
          <input id="you-addressLine1" className="input" maxLength={200} autoComplete="street-address" {...text('addressLine1')} />
        </Field>
        <div className="aap__pair">
          <Field id="you-city" label={t('you.city')} error={errorFor('city')}>
            <input id="you-city" className="input" maxLength={60} {...text('city')} />
          </Field>
          <Field id="you-pincode" label={t('aap.pincode')} error={errorFor('pincode')}>
            <input id="you-pincode" className="input input--numeric" inputMode="numeric" maxLength={6} {...text('pincode', (v) => v.replace(/\D/g, ''))} />
          </Field>
        </div>
        <Field id="you-stateCode" label={t('you.state')} hint={t('you.stateHint')} error={errorFor('stateCode')}>
          <select id="you-stateCode" className="select" {...text('stateCode')}>
            <option value="">{t('you.stateChoose')}</option>
            {GST_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="you-email" label={`${t('aap.email')} · ${t('common.optional')}`} error={errorFor('email')}>
          <input id="you-email" className="input" type="email" inputMode="email" maxLength={120} autoCapitalize="none" {...text('email')} />
        </Field>
      </section>

      <section className="card stack">
        <h2 className="card__title">{t('aap.gst')}</h2>
        <Field id="you-gstin" label={`${t('you.gstin')} · ${t('common.optional')}`} hint={t('you.gstinHint')} error={errorFor('gstin')}>
          <input
            id="you-gstin"
            className="input"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={15}
            placeholder="27ABCDE1234F1Z5"
            {...text('gstin', (v) => v.toUpperCase())}
          />
        </Field>
        {(form.gstin ?? '').trim() && (
          <div className="field">
            <span className="field__label" id="you-einv-label">{t('einv.ask')}</span>
            <div className="chips" role="group" aria-labelledby="you-einv-label">
              <button type="button" id="you-eInvoicingApplies" className="chip" aria-pressed={form.eInvoicingApplies === false} onClick={() => update({ eInvoicingApplies: false }, 'eInvoicingApplies')}>
                <span className="chip__name">{t('einv.no')}</span>
              </button>
              <button type="button" className="chip" aria-pressed={form.eInvoicingApplies === true} onClick={() => update({ eInvoicingApplies: true }, 'eInvoicingApplies')}>
                <span className="chip__name">{t('einv.yes')}</span>
              </button>
            </div>
            {errorFor('eInvoicingApplies') && <span className="field__error" role="alert">{errorFor('eInvoicingApplies')}</span>}
          </div>
        )}
      </section>

      <section className="card stack">
        <div>
          <h2 className="card__title">{t('aap.pay')}</h2>
          <p className="card__sub">{t('aap.paySub')}</p>
        </div>
        <Field id="you-upiId" label={`${t('you.upi')} · ${t('common.optional')}`} hint={t('you.upiExample')} error={errorFor('upiId')}>
          <input id="you-upiId" className="input" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" maxLength={100} {...text('upiId')} />
        </Field>
        <details className="disclosure" open={Boolean(form.accountNumber || form.ifsc)}>
          <summary>{`${t('aap.bank')} · ${t('common.optional')}`}</summary>
          <div className="disclosure__body stack">
            <Field id="you-accountHolderName" label={t('aap.holder')} error={errorFor('accountHolderName')}>
              <input id="you-accountHolderName" className="input" maxLength={120} {...text('accountHolderName')} />
            </Field>
            <Field id="you-accountNumber" label={t('aap.account')} error={errorFor('accountNumber')}>
              <input id="you-accountNumber" className="input input--numeric" inputMode="numeric" maxLength={20} {...text('accountNumber', (v) => v.replace(/\D/g, ''))} />
            </Field>
            <div className="aap__pair">
              <Field id="you-ifsc" label={t('aap.ifsc')} error={errorFor('ifsc')}>
                <input id="you-ifsc" className="input" autoCapitalize="characters" maxLength={11} placeholder="SBIN0001234" {...text('ifsc', (v) => v.toUpperCase())} />
              </Field>
              <Field id="you-bankName" label={t('aap.bankName')} error={errorFor('bankName')}>
                <input id="you-bankName" className="input" maxLength={120} {...text('bankName')} />
              </Field>
            </div>
          </div>
        </details>
      </section>

      <BillLookSection
        businessId={businessId}
        look={form.look ?? DEFAULT_LOOK}
        logo={form.logoDataUrl ?? null}
        error={errorFor('logoDataUrl')}
        onLook={(patch) => update({ look: { ...(form.look ?? DEFAULT_LOOK), ...patch } })}
        onLogo={(logoDataUrl) => update({ logoDataUrl }, 'logoDataUrl')}
      />

      <section className="card stack">
        <div>
          <h2 className="card__title">{t('num.title')}</h2>
          <p className="card__sub">{t('num.sub', { preview })}</p>
        </div>
        <div className="aap__pair">
          <Field id="num-prefix" label={t('num.prefix')} error={errorFor('prefix')}>
            <input id="num-prefix" className="input" maxLength={10} autoCapitalize="characters" {...text('prefix')} />
          </Field>
          <Field id="num-next" label={t('num.next')} error={errorFor('nextNumber')}>
            <input id="num-next" className="input input--numeric" inputMode="numeric" {...text('nextNumber', (v) => v.replace(/\D/g, ''))} />
          </Field>
        </div>
        <span className="field__hint">{t('num.nextHint')}</span>
        <label className="row row--tight" style={{ minHeight: 44 }}>
          <input
            type="checkbox"
            checked={form.includeFinancialYear}
            onChange={(e) => update({ includeFinancialYear: e.target.checked })}
            style={{ width: 22, height: 22, accentColor: 'var(--accent-fill)' }}
          />
          <span>{t('num.fy')}</span>
        </label>
        <Field id="you-paymentTermsDays" label={t('aap.terms')} hint={t('aap.termsHint')} error={errorFor('paymentTermsDays')}>
          <select id="you-paymentTermsDays" className="select" {...text('paymentTermsDays')}>
            {PAYMENT_TERMS.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? t('aap.terms0') : t('aap.termsN', { n })}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <details className="card disclosure">
        <summary>{t('aap.info')}</summary>
        <div className="disclosure__body stack stack--tight small">
          <InfoRow label={t('aap.info.signin')} value={info.signInOn ? t('aap.info.signinOn') : t('aap.info.signinOff')} warn={!info.signInOn} />
          <InfoRow label={t('aap.info.pdf')} value={info.pdf === 'on' ? t('aap.info.on') : t('aap.info.broken')} warn={info.pdf !== 'on'} />
          <InfoRow label={t('aap.info.voice')} value={info.voice === 'on' ? t('aap.info.on') : t('aap.info.off')} />
          <InfoRow
            label={t('aap.info.photos')}
            value={info.photos === 'on' ? t('aap.info.on') : info.photos === 'off' ? t('aap.info.off') : t('aap.info.broken')}
            warn={info.photos === 'broken'}
          />
          <button
            type="button"
            className="btn btn--ghost btn--small"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => {
              try {
                Object.keys(localStorage)
                  .filter((k) => k.startsWith('ekbill.tour.') && k !== 'ekbill.tour.auto')
                  .forEach((k) => localStorage.removeItem(k));
              } catch {
                // No storage: nothing was remembered, so every tour shows anyway.
              }
              setTourNote(true);
            }}
          >
            {t('aap.tourAgain')}
          </button>
          {tourNote && <span className="faint">{t('aap.tourReset')}</span>}
        </div>
      </details>

      {error && (
        <div className="notice notice--danger" role="alert">
          <span className="notice__icon" aria-hidden="true">!</span>
          <span>{error}</span>
        </div>
      )}

      <div className="make-bar save-bar">
        <span className="save-bar__state" role="status">
          {saved ? saved : dirty ? t('aap.saveBar') : ''}
        </span>
        <button type="submit" className="btn btn--primary btn--large make-bar__go" disabled={busy} data-guide-tap="owner">
          {busy ? <span className="spinner" aria-hidden="true" /> : null}
          {t('common.save')}
        </button>
      </div>
    </form>
  );
}

function Field(props: { id: string; label: string; hint?: string; error: string | null; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={props.id}>
        {props.label}
      </label>
      {props.children}
      {props.error ? (
        <span className="field__error" role="alert">
          {props.error}
        </span>
      ) : props.hint ? (
        <span className="field__hint">{props.hint}</span>
      ) : null}
    </div>
  );
}

function InfoRow({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="row row--between" style={{ gap: 12 }}>
      <span className="muted">{label}</span>
      <span style={warn ? { color: 'var(--warn)', fontWeight: 650, textAlign: 'right' } : { textAlign: 'right' }}>{value}</span>
    </div>
  );
}
