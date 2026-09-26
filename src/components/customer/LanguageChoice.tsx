'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { setCustomerLanguageAction } from '@/app/actions/customers';
import { CUSTOMER_LANGUAGE_NAMES, CUSTOMER_LANGUAGES_AVAILABLE, t, type CustomerLanguage } from '@/lib/copy';
import type { LanguageGuess } from '@/lib/domain/language-guess';

export interface LanguageState {
  customerId: string | null;
  current: CustomerLanguage;
  /** Set when the app thinks another language would suit, and the owner has not said. */
  suggestion: LanguageGuess | null;
}

/**
 * Which language the message is in, and the app's suggestion when it has
 * one. The suggestion is a question with two buttons; nothing changes until
 * the owner answers, and "Hinglish hi rakho" is remembered so it is not
 * asked again. Any language can be picked from the list below either way.
 */
export function LanguageChoice({ businessId, state }: { businessId: string; state: LanguageState }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const name = (l: CustomerLanguage) => CUSTOMER_LANGUAGE_NAMES[l].hi;

  async function choose(language: CustomerLanguage) {
    if (!state.customerId) return;
    setBusy(true);
    await setCustomerLanguageAction(businessId, state.customerId, language);
    setBusy(false);
    setOpen(false);
    router.refresh();
  }

  const s = state.suggestion;
  return (
    <section className="card stack stack--tight">
      <div className="row row--between">
        <span className="small">{t('lang.current', { lang: name(state.current) })}</span>
        {state.customerId && (
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setOpen((o) => !o)}>
            {t('lang.change')}
          </button>
        )}
      </div>
      {s && state.customerId && !open && (
        <div className="notice notice--info">
          <span className="notice__icon" aria-hidden="true">i</span>
          <div className="stack stack--tight">
            <span className="small">
              {s.reason === 'name'
                ? t('lang.suggestName', { because: s.because, lang: name(s.language) })
                : t('lang.suggestPlace', { because: s.because, lang: name(s.language) })}
            </span>
            <div className="row row--tight">
              <button type="button" className="btn btn--primary btn--small" disabled={busy} onClick={() => void choose(s.language)}>
                {t('lang.use', { lang: name(s.language) })}
              </button>
              <button type="button" className="btn btn--secondary btn--small" disabled={busy} onClick={() => void choose('hi')}>
                {t('lang.keep')}
              </button>
            </div>
          </div>
        </div>
      )}
      {open && (
        <div className="chips" role="group" aria-label={t('lang.change')}>
          {CUSTOMER_LANGUAGES_AVAILABLE.map((l) => (
            <button key={l} type="button" className="chip" aria-pressed={l === state.current} disabled={busy} onClick={() => void choose(l)}>
              <span className="chip__name">{name(l)}</span>
            </button>
          ))}
        </div>
      )}
      {state.current !== 'hi' && <span className="faint">{t('lang.review')}</span>}
    </section>
  );
}
