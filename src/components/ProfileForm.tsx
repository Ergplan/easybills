'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createBusinessAction, saveProfileAction } from '@/app/actions/business';
import { seedDemoBusinessAction } from '@/app/actions/demo';
import { t } from '@/lib/copy';
import { formatPhone, parseProfile, type ProfileField, type ProfileInput } from '@/lib/domain/profile';
import { GST_STATES } from '@/lib/gst/state-codes';

interface Props {
  /** The number the owner signed in with. Shown, not asked again. */
  phone: string | null;
  /**
   * First time, this creates the business and goes to Home. Later, under
   * "Aap", it saves the same five fields in place.
   */
  mode: 'create' | 'edit';
  businessId?: string;
  initial?: Partial<ProfileInput>;
}

/**
 * "Apne baare mein batayen." Five fields, and a GST number is the only one
 * that changes anything: with one, the GST tab exists; without, it does not.
 *
 * Checks run as the owner leaves each field, with the same `parseProfile` the
 * server uses, so the message they see while typing is the message they would
 * have got back -- and never a second, different one.
 */
export function ProfileForm({ phone, mode, businessId, initial }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<ProfileInput>({
    name: initial?.name ?? '',
    phone: phone ?? initial?.phone ?? '',
    gstin: initial?.gstin ?? '',
    upiId: initial?.upiId ?? '',
    city: initial?.city ?? '',
    stateCode: initial?.stateCode ?? '',
  });
  const [problem, setProblem] = useState<{ field: ProfileField; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (field: ProfileField) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setSaved(false);
    if (problem?.field === field) setProblem(null);
  };

  function check(): boolean {
    const r = parseProfile(form);
    if (r.ok) return true;
    setProblem({ field: r.field, message: r.message });
    document.getElementById(`you-${r.field}`)?.focus();
    return false;
  }

  const errorFor = (field: ProfileField) => (problem?.field === field ? problem.message : null);

  return (
    <div className="stack">
      <form
        className="card stack"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (!check()) return;
          setBusy(true);
          setError(null);
          setSaved(false);
          const r =
            mode === 'create' ? await createBusinessAction(form) : await saveProfileAction(businessId!, form);
          if (r.ok) {
            if (mode === 'create') {
              router.replace('/home');
              router.refresh();
              return;
            }
            setBusy(false);
            setSaved(true);
            router.refresh();
            return;
          }
          setBusy(false);
          if ('field' in r) setProblem({ field: r.field, message: r.error });
          else setError(r.error);
        }}
      >
        <Field id="you-name" label={t('you.name')} hint={t('you.nameHint')} error={errorFor('name')}>
          <input
            id="you-name"
            className="input"
            value={form.name}
            onChange={set('name')}
            autoComplete="organization"
            autoFocus={mode === 'create'}
            maxLength={120}
          />
        </Field>

        <Field id="you-phone" label={t('you.phone')} hint={t('you.phoneHint')} error={errorFor('phone')}>
          {phone ? (
            <input id="you-phone" className="input" value={formatPhone(phone)} readOnly />
          ) : (
            <div className="tel">
              <span className="tel__prefix" aria-hidden="true">+91</span>
              <input
                id="you-phone"
                className="input tel__input"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                value={form.phone}
                onChange={set('phone')}
              />
            </div>
          )}
        </Field>

        <Field
          id="you-gstin"
          label={`${t('you.gstin')} · ${t('common.optional')}`}
          hint={t('you.gstinHint')}
          error={errorFor('gstin')}
        >
          <input
            id="you-gstin"
            className="input"
            value={form.gstin ?? ''}
            onChange={(e) => {
              setForm((f) => ({ ...f, gstin: e.target.value.toUpperCase() }));
              setSaved(false);
              if (problem?.field === 'gstin' || problem?.field === 'stateCode') setProblem(null);
            }}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={15}
            placeholder="27ABCDE1234F1Z5"
          />
        </Field>

        <Field
          id="you-upiId"
          label={`${t('you.upi')} · ${t('common.optional')}`}
          hint={`${t('you.upiHint')} (${t('you.upiExample')})`}
          error={errorFor('upiId')}
        >
          <input
            id="you-upiId"
            className="input"
            value={form.upiId ?? ''}
            onChange={set('upiId')}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="email"
            maxLength={100}
          />
        </Field>

        <div className="you-place">
          <Field id="you-city" label={t('you.city')} error={errorFor('city')}>
            <input
              id="you-city"
              className="input"
              value={form.city ?? ''}
              onChange={set('city')}
              autoComplete="address-level2"
              maxLength={100}
            />
          </Field>
          <Field id="you-stateCode" label={t('you.state')} hint={t('you.stateHint')} error={errorFor('stateCode')}>
            <select id="you-stateCode" className="select" value={form.stateCode ?? ''} onChange={set('stateCode')}>
              <option value="">{t('you.stateChoose')}</option>
              {GST_STATES.map((s) => (
                <option key={s.code} value={s.code}>{s.name}</option>
              ))}
            </select>
          </Field>
        </div>

        {error && (
          <div className="notice notice--danger" role="alert">
            <span className="notice__icon" aria-hidden="true">!</span>
            <span>{error}</span>
          </div>
        )}
        {saved && (
          <div className="notice notice--ok" role="status">
            <span className="notice__icon" aria-hidden="true">✓</span>
            <span>{t('you.saved')}</span>
          </div>
        )}

        <button type="submit" className="btn btn--primary btn--block btn--large" disabled={busy || !form.name.trim()}>
          {busy ? <span className="spinner" aria-hidden="true" /> : null}
          {mode === 'create' ? t('you.start') : t('common.save')}
        </button>
      </form>

      {/* For the owner who wants to see it working before typing their own name in. */}
      {mode === 'create' && (
        <div className="stack stack--tight" style={{ alignItems: 'center', textAlign: 'center' }}>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const r = await seedDemoBusinessAction();
              if (r.ok) {
                router.replace('/home');
                router.refresh();
                return;
              }
              setBusy(false);
              setError(r.error);
            }}
          >
            {t('you.demo')}
          </button>
          <span className="faint">{t('you.demoNote')}</span>
        </div>
      )}
    </div>
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
