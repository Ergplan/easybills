'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { createBusinessAction } from '@/app/actions/business';
import { seedDemoBusinessAction } from '@/app/actions/demo';
import { t } from '@/lib/copy';
import { formatPhone, parseProfile, type ProfileField, type ProfileInput } from '@/lib/domain/profile';
import { checkGstin } from '@/lib/gst/gstin';
import { GST_STATES } from '@/lib/gst/state-codes';

type Step = 'name' | 'phone' | 'hasGst' | 'gstin' | 'upi' | 'place' | 'review';

/** The fields each step answers, for showing the right check at the right time. */
const STEP_FIELDS: Record<Step, ProfileField[]> = {
  name: ['name'],
  phone: ['phone'],
  hasGst: [],
  gstin: ['gstin', 'eInvoicingApplies'],
  upi: ['upiId'],
  place: ['city', 'stateCode'],
  review: [],
};

/**
 * The first time: one question per screen, like someone at the counter
 * asking. Name; phone (only when sign-in did not already give it); GST or
 * not; the GST number if so; UPI (skippable); city and state; then "Sab sahi
 * hai?" with every answer and a Badlo beside each. Voice can walk it too:
 * each screen has one field and an Aage.
 */
export function StartWizard({ phone }: { phone: string | null }) {
  const router = useRouter();
  const [form, setForm] = useState<ProfileInput>({ name: '', phone: phone ?? '', gstin: '', upiId: '', city: '', stateCode: '', eInvoicingApplies: null });
  const [hasGst, setHasGst] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>('name');
  const [problem, setProblem] = useState<{ field: ProfileField; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Came here with "Badlo" from the last screen: Aage goes straight back there. */
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  const steps: Step[] = ['name', ...(phone ? [] : (['phone'] as Step[])), 'hasGst', ...(hasGst ? (['gstin'] as Step[]) : []), 'upi', 'place', 'review'];
  const at = steps.indexOf(step);

  useEffect(() => {
    input.current?.focus();
    // Voice, if it is on, hears that there is a new question on the screen.
    window.dispatchEvent(new CustomEvent('ekbill:step', { detail: step }));
  }, [step]);

  const goTo = (s: Step) => {
    setProblem(null);
    if (s === 'review') setEditing(false);
    setStep(s);
  };
  const change = (s: Step) => {
    setEditing(true);
    goTo(s);
  };

  const set = (patch: Partial<ProfileInput>) => {
    setForm((f) => ({ ...f, ...patch }));
    setProblem(null);
  };

  /** The check for this step: parseProfile's first complaint, if it is about a field on this screen. */
  function stepOk(s: Step): boolean {
    const fields = STEP_FIELDS[s];
    if (!fields.length) return true;
    const r = parseProfile({ ...form, gstin: hasGst ? form.gstin : '' });
    if (r.ok || !fields.includes(r.field)) return true;
    setProblem({ field: r.field, message: r.message });
    return false;
  }

  function next() {
    if (!stepOk(step)) return;
    if (step === 'gstin') {
      // The state is in the GST number; fill it so the owner is not asked twice.
      const g = checkGstin(form.gstin);
      if (g.ok && g.stateCode) set({ stateCode: g.stateCode });
    }
    const following = editing ? 'review' : steps[at + 1];
    if (following) goTo(following);
  }

  function back() {
    const before = editing ? 'review' : steps[at - 1];
    if (before) goTo(before);
  }

  async function create() {
    const final = { ...form, gstin: hasGst ? form.gstin : '' };
    const r0 = parseProfile(final);
    if (!r0.ok) {
      const owner = (Object.keys(STEP_FIELDS) as Step[]).find((s) => STEP_FIELDS[s].includes(r0.field)) ?? 'name';
      setStep(owner);
      setProblem({ field: r0.field, message: r0.message });
      return;
    }
    setBusy(true);
    setError(null);
    const r = await createBusinessAction(final);
    if (r.ok) {
      router.replace('/home');
      router.refresh();
      return;
    }
    setBusy(false);
    if ('field' in r) {
      const owner = (Object.keys(STEP_FIELDS) as Step[]).find((s) => STEP_FIELDS[s].includes(r.field)) ?? 'name';
      setStep(owner);
      setProblem({ field: r.field, message: r.error });
    } else setError(r.error);
  }

  const err = (field: ProfileField) =>
    problem?.field === field ? (
      <span className="field__error" role="alert">
        {problem.message}
      </span>
    ) : null;

  const nextButton = (label = t('start.next')) => (
    <button type="submit" className="btn btn--primary btn--block btn--large" disabled={busy}>
      {label}
    </button>
  );

  return (
    <div className="wizard stack">
      <div className="wizard__progress" aria-label={t('start.step', { n: at + 1, total: steps.length })}>
        {steps.map((s, i) => (
          <span key={s} className={`wizard__dot${i <= at ? ' wizard__dot--done' : ''}`} />
        ))}
      </div>

      <form
        className="card stack wizard__card"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (step === 'review') void create();
          else next();
        }}
      >
        {step === 'name' && (
          <>
            <label className="wizard__q" htmlFor="you-name">{t('start.q.name')}</label>
            <input
              id="you-name"
              ref={(el) => {
                input.current = el;
              }}
              className="input input--large"
              value={form.name}
              maxLength={120}
              placeholder={t('start.q.nameExample')}
              onChange={(e) => set({ name: e.target.value })}
            />
            <span className="field__hint">{t('you.nameHint')}</span>
            {err('name')}
            {nextButton()}
          </>
        )}

        {step === 'phone' && (
          <>
            <label className="wizard__q" htmlFor="you-phone">{t('start.q.phone')}</label>
            <input
              id="you-phone"
              ref={(el) => {
                input.current = el;
              }}
              className="input input--large"
              type="tel"
              inputMode="tel"
              maxLength={16}
              placeholder="98765 43210"
              value={form.phone}
              onChange={(e) => set({ phone: e.target.value })}
            />
            {err('phone')}
            {nextButton()}
          </>
        )}

        {step === 'hasGst' && (
          <>
            <span className="wizard__q" id="you-hasGst-label">{t('start.q.hasGst')}</span>
            <span className="field__hint">{t('start.q.hasGstHint')}</span>
            <div className="wizard__choices" role="group" aria-labelledby="you-hasGst-label">
              <button
                type="button"
                className="btn btn--secondary btn--large"
                onClick={() => {
                  setHasGst(true);
                  goTo('gstin');
                }}
              >
                {t('start.gstYes')}
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--large"
                onClick={() => {
                  setHasGst(false);
                  set({ gstin: '', eInvoicingApplies: null });
                  goTo(editing ? 'review' : 'upi');
                }}
              >
                {t('start.gstNo')}
              </button>
            </div>
          </>
        )}

        {step === 'gstin' && (
          <>
            <label className="wizard__q" htmlFor="you-gstin">{t('start.q.gstin')}</label>
            <input
              id="you-gstin"
              ref={(el) => {
                input.current = el;
              }}
              className="input input--large"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={15}
              placeholder="27ABCDE1234F1Z5"
              value={form.gstin ?? ''}
              onChange={(e) => set({ gstin: e.target.value.toUpperCase() })}
            />
            {err('gstin')}
            <span className="field__label" id="you-einv-label">{t('einv.ask')}</span>
            <div className="chips" role="group" aria-labelledby="you-einv-label">
              <button type="button" id="you-eInvoicingApplies" className="chip" aria-pressed={form.eInvoicingApplies === false} onClick={() => set({ eInvoicingApplies: false })}>
                <span className="chip__name">{t('einv.no')}</span>
              </button>
              <button type="button" className="chip" aria-pressed={form.eInvoicingApplies === true} onClick={() => set({ eInvoicingApplies: true })}>
                <span className="chip__name">{t('einv.yes')}</span>
              </button>
            </div>
            {err('eInvoicingApplies')}
            {nextButton()}
          </>
        )}

        {step === 'upi' && (
          <>
            <label className="wizard__q" htmlFor="you-upiId">{t('start.q.upi')}</label>
            <span className="field__hint">{t('you.upiHint')}</span>
            <input
              id="you-upiId"
              ref={(el) => {
                input.current = el;
              }}
              className="input input--large"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="email"
              maxLength={100}
              placeholder="sharma@upi"
              value={form.upiId ?? ''}
              onChange={(e) => set({ upiId: e.target.value })}
            />
            {err('upiId')}
            {nextButton()}
            {!(form.upiId ?? '').trim() && (
              <button type="button" className="btn btn--ghost" onClick={() => goTo(editing ? 'review' : 'place')}>
                {t('start.skip')}
              </button>
            )}
          </>
        )}

        {step === 'place' && (
          <>
            <label className="wizard__q" htmlFor="you-city">{t('start.q.place')}</label>
            <input
              id="you-city"
              ref={(el) => {
                input.current = el;
              }}
              className="input input--large"
              maxLength={60}
              placeholder={t('start.q.placeExample')}
              value={form.city ?? ''}
              onChange={(e) => set({ city: e.target.value })}
            />
            {err('city')}
            <label className="field__label" htmlFor="you-stateCode">{t('you.state')}</label>
            <select id="you-stateCode" className="select" value={form.stateCode ?? ''} onChange={(e) => set({ stateCode: e.target.value })}>
              <option value="">{t('you.stateChoose')}</option>
              {GST_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
            <span className="field__hint">{hasGst ? t('start.stateFromGst') : t('you.stateHint')}</span>
            {err('stateCode')}
            {nextButton()}
          </>
        )}

        {step === 'review' && (
          <>
            <span className="wizard__q">{t('start.q.review')}</span>
            <dl className="wizard__review">
              <ReviewRow label={t('you.name')} value={form.name} onChange={() => change('name')} />
              {!phone && <ReviewRow label={t('you.phone')} value={formatPhone(form.phone) || form.phone} onChange={() => change('phone')} />}
              <ReviewRow label={t('you.gstin')} value={hasGst ? (form.gstin ?? '') : t('start.gstNo')} onChange={() => change('hasGst')} />
              <ReviewRow label={t('you.upi')} value={(form.upiId ?? '').trim() || '—'} onChange={() => change('upi')} />
              <ReviewRow
                label={t('you.city')}
                value={[form.city, GST_STATES.find((s) => s.code === form.stateCode)?.name].filter(Boolean).join(', ') || '—'}
                onChange={() => change('place')}
              />
            </dl>
            {error && (
              <div className="notice notice--danger" role="alert">
                <span className="notice__icon" aria-hidden="true">!</span>
                <span>{error}</span>
              </div>
            )}
            <button type="submit" className="btn btn--primary btn--block btn--large" disabled={busy} data-guide-tap="owner">
              {busy ? <span className="spinner" aria-hidden="true" /> : null}
              {t('you.start')}
            </button>
          </>
        )}

        {(at > 0 || editing) && (
          <button type="button" className="btn btn--ghost wizard__back" onClick={back} disabled={busy}>
            {t('start.back')}
          </button>
        )}
      </form>

      {step === 'name' && (
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
          {error && <span className="field__error">{error}</span>}
        </div>
      )}
    </div>
  );
}

function ReviewRow({ label, value, onChange }: { label: string; value: string; onChange: () => void }) {
  return (
    <div className="wizard__row">
      <div>
        <dt className="faint small">{label}</dt>
        <dd>{value}</dd>
      </div>
      <button type="button" className="btn btn--ghost btn--small" onClick={onChange}>
        {t('start.change')}
      </button>
    </div>
  );
}
