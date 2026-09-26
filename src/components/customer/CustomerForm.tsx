'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { saveCustomerAction } from '@/app/actions/customers';
import { CUSTOMER_LANGUAGE_NAMES, CUSTOMER_LANGUAGES_AVAILABLE, t, type CustomerLanguage } from '@/lib/copy';
import { parseCustomer, type CustomerField, type CustomerInput } from '@/lib/domain/customer-form';
import type { LanguageGuess } from '@/lib/domain/language-guess';
import { GST_STATES } from '@/lib/gst/state-codes';

/**
 * "Customer ke baare mein batayen." The GST number is the field that
 * matters: it fills the state, and the state decides CGST+SGST or IGST on
 * the next bill. Everything else is what the bill prints and how the
 * reminder speaks.
 */
export function CustomerForm({
  businessId,
  customerId,
  initial,
  suggestion,
}: {
  businessId: string;
  customerId: string;
  initial: CustomerInput;
  suggestion: LanguageGuess | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState<CustomerInput>(initial);
  const [problem, setProblem] = useState<{ field: CustomerField; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (field: CustomerField, transform?: (v: string) => string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = transform ? transform(e.target.value) : e.target.value;
    setForm((f) => ({ ...f, [field]: v }));
    setSaved(false);
    if (problem) setProblem(null);
  };
  const errorFor = (field: CustomerField) => (problem?.field === field ? problem.message : null);
  const languageName = (l: CustomerLanguage) => CUSTOMER_LANGUAGE_NAMES[l].hi;

  return (
    <form
      className="card stack"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const checked = parseCustomer(form);
        if (!checked.ok) {
          setProblem({ field: checked.field, message: checked.message });
          document.getElementById(`c-${checked.field}`)?.focus();
          return;
        }
        setBusy(true);
        setError(null);
        const r = await saveCustomerAction(businessId, customerId, form);
        setBusy(false);
        if (r.ok) {
          // What the server kept, including the state and PAN it read from
          // the GST number, so the form shows what the record now says.
          const c = r.data;
          setForm({
            name: c.name,
            contactPerson: c.contactPerson ?? '',
            phone: c.phone ?? '',
            gstin: c.gstin ?? '',
            pan: c.pan ?? '',
            addressLine1: c.addressLine1 ?? '',
            city: c.city ?? '',
            pincode: c.pincode ?? '',
            stateCode: c.stateCode ?? '',
            language: c.language ?? '',
          });
          setSaved(true);
          router.refresh();
          return;
        }
        if ('field' in r) setProblem({ field: r.field, message: r.error });
        else setError(r.error);
      }}
    >
      <Field id="c-name" label={t('customer.name')} error={errorFor('name')}>
        <input id="c-name" className="input" value={form.name} onChange={set('name')} maxLength={200} />
      </Field>
      <Field id="c-contactPerson" label={t('customer.person')} hint={t('customer.personHint')} error={errorFor('contactPerson')}>
        <input id="c-contactPerson" className="input" value={form.contactPerson ?? ''} onChange={set('contactPerson')} maxLength={100} />
      </Field>
      <Field id="c-phone" label={t('customer.phone')} error={errorFor('phone')}>
        <input id="c-phone" className="input" type="tel" inputMode="numeric" value={form.phone ?? ''} onChange={set('phone')} maxLength={16} />
      </Field>

      <Field id="c-gstin" label={t('customer.gstin')} hint={t('customer.gstinHint')} error={errorFor('gstin')}>
        <input
          id="c-gstin"
          className="input"
          value={form.gstin ?? ''}
          onChange={set('gstin', (v) => v.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={15}
          placeholder="27ABCDE1234F1Z5"
        />
      </Field>
      <Field id="c-pan" label={t('customer.pan')} error={errorFor('pan')}>
        <input
          id="c-pan"
          className="input"
          value={form.pan ?? ''}
          onChange={set('pan', (v) => v.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={10}
          placeholder="ABCDE1234F"
        />
      </Field>

      <Field id="c-addressLine1" label={t('customer.address')} error={errorFor('addressLine1')}>
        <input id="c-addressLine1" className="input" value={form.addressLine1 ?? ''} onChange={set('addressLine1')} maxLength={200} autoComplete="street-address" />
      </Field>
      <div className="you-place">
        <Field id="c-city" label={t('customer.city')} error={errorFor('city')}>
          <input id="c-city" className="input" value={form.city ?? ''} onChange={set('city')} maxLength={100} />
        </Field>
        <Field id="c-pincode" label={t('customer.pincode')} error={errorFor('pincode')}>
          <input id="c-pincode" className="input input--numeric" inputMode="numeric" value={form.pincode ?? ''} onChange={set('pincode')} maxLength={6} />
        </Field>
      </div>
      <Field id="c-stateCode" label={t('customer.state')} hint={t('customer.stateHint')} error={errorFor('stateCode')}>
        <select id="c-stateCode" className="select" value={form.stateCode ?? ''} onChange={set('stateCode')}>
          <option value="">{t('you.stateChoose')}</option>
          {GST_STATES.map((s) => (
            <option key={s.code} value={s.code}>{s.name}</option>
          ))}
        </select>
      </Field>

      <Field id="c-language" label={t('customer.language')} hint={t('customer.languageHint')} error={errorFor('language')}>
        <select id="c-language" className="select" value={form.language ?? ''} onChange={set('language')}>
          <option value="">Hinglish</option>
          {CUSTOMER_LANGUAGES_AVAILABLE.filter((l) => l !== 'hi').map((l) => (
            <option key={l} value={l}>{languageName(l)}</option>
          ))}
        </select>
        {suggestion && !form.language && (
          <button
            type="button"
            className="btn btn--secondary btn--small"
            style={{ alignSelf: 'flex-start', marginTop: 6 }}
            onClick={() => {
              setForm((f) => ({ ...f, language: suggestion.language }));
              setSaved(false);
            }}
          >
            {suggestion.reason === 'name'
              ? t('lang.suggestName', { because: suggestion.because, lang: languageName(suggestion.language) })
              : t('lang.suggestPlace', { because: suggestion.because, lang: languageName(suggestion.language) })}
          </button>
        )}
      </Field>

      {error && (
        <div className="notice notice--danger" role="alert">
          <span className="notice__icon" aria-hidden="true">!</span>
          <span>{error}</span>
        </div>
      )}
      {saved && (
        <div className="notice notice--ok" role="status">
          <span className="notice__icon" aria-hidden="true">✓</span>
          <span>{t('common.saved')}</span>
        </div>
      )}

      <button type="submit" className="btn btn--primary btn--block btn--large" disabled={busy || !form.name.trim()}>
        {busy ? <span className="spinner" aria-hidden="true" /> : null}
        {t('customer.save')}
      </button>
    </form>
  );
}

function Field(props: { id: string; label: string; hint?: string; error: string | null; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={props.id}>{props.label}</label>
      {props.children}
      {props.error ? (
        <span className="field__error" role="alert">{props.error}</span>
      ) : props.hint ? (
        <span className="field__hint">{props.hint}</span>
      ) : null}
    </div>
  );
}
