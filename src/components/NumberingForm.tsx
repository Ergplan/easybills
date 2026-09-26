'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { setNumberingAction } from '@/app/actions/business';
import { t } from '@/lib/copy';
import type { FinancialYear } from '@/lib/dates';
import { previewNumber } from '@/lib/domain/bill-guard';
import type { NumberingSeries } from '@/lib/domain/types';

/**
 * "Bill number." What the next bill will be called, in three fields: what
 * it starts with, whether the year is in it, and the next number. The
 * preview is the actual next number, and it cannot go backwards.
 */
export function NumberingForm({ businessId, numbering, fy }: { businessId: string; numbering: NumberingSeries; fy: FinancialYear }) {
  const router = useRouter();
  const [prefix, setPrefix] = useState(numbering.prefix);
  const [includeFy, setIncludeFy] = useState(numbering.includeFinancialYear);
  const [next, setNext] = useState(String(numbering.nextNumber));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const min = numbering.nextNumber > 1 ? numbering.nextNumber : 1;
  const nextNumber = Number(next);
  const preview = Number.isFinite(nextNumber) && nextNumber >= 1 ? previewNumber({ prefix, nextNumber: Math.floor(nextNumber), padding: numbering.padding, includeFinancialYear: includeFy }, fy) : '—';

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        setNote(null);
        const r = await setNumberingAction(businessId, { prefix, nextNumber, includeFinancialYear: includeFy });
        setBusy(false);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setNote(t('num.saved', { preview: r.data.preview }));
        router.refresh();
      }}
    >
      <div>
        <h2 className="card__title" style={{ fontSize: '1.15rem' }}>{t('num.title')}</h2>
        <p className="card__sub">{t('num.sub', { preview })}</p>
      </div>
      <div className="you-place">
        <div className="field">
          <label className="field__label" htmlFor="num-prefix">{t('num.prefix')}</label>
          <input id="num-prefix" className="input" value={prefix} maxLength={10} autoCapitalize="characters" onChange={(e) => setPrefix(e.target.value)} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="num-next">{t('num.next')}</label>
          <input id="num-next" className="input input--numeric" inputMode="numeric" value={next} min={min} onChange={(e) => setNext(e.target.value.replace(/\D/g, ''))} />
          <span className="field__hint">{t('num.nextHint')}</span>
        </div>
      </div>
      <label className="row row--tight" style={{ minHeight: 44 }}>
        <input type="checkbox" checked={includeFy} onChange={(e) => setIncludeFy(e.target.checked)} style={{ width: 22, height: 22, accentColor: 'var(--accent-fill)' }} />
        <span>{t('num.fy')}</span>
      </label>
      {error && <span className="field__error" role="alert">{error}</span>}
      {note && (
        <div className="notice notice--ok" role="status">
          <span className="notice__icon" aria-hidden="true">✓</span>
          <span>{note}</span>
        </div>
      )}
      <button type="submit" className="btn btn--secondary" disabled={busy} style={{ alignSelf: 'flex-start' }}>
        {busy ? <span className="spinner" aria-hidden="true" /> : null}
        {t('common.save')}
      </button>
    </form>
  );
}
