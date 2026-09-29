'use client';

import { useEffect, useRef, useState } from 'react';

import { t } from '@/lib/copy';
import {
  BILL_ACCENTS,
  BILL_DESIGNS,
  BILL_PAPERS,
  BILL_SHARE,
  LOGO_MAX_CHARS,
  designName,
  paperName,
  type BillDesign,
  type BillLook,
} from '@/lib/domain/bill-look';

const DESIGN_HINT: Record<BillDesign, 'look.design.classicHint' | 'look.design.modernHint' | 'look.design.simpleHint'> = {
  classic: 'look.design.classicHint',
  modern: 'look.design.modernHint',
  simple: 'look.design.simpleHint',
};

/**
 * Shrink a picked picture to a logo: at most 600 x 240, PNG when it came as
 * PNG (a transparent logo stays transparent), JPEG otherwise, and smaller
 * again until it fits what a bill keeps.
 */
async function toLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(t('look.logo.bad')));
      el.src = url;
    });
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    for (let maxW = 600; maxW >= 150; maxW = Math.round(maxW * 0.7)) {
      const scale = Math.min(1, maxW / img.naturalWidth, (maxW * 0.4) / img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) break;
      if (type === 'image/jpeg') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL(type, 0.88);
      if (data.length <= LOGO_MAX_CHARS) return data;
    }
    throw new Error(t('look.logo.tooBig'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * "Bill kaisa dikhe": the logo, the design, the colour, the paper and what
 * WhatsApp gets -- part of Aap's one Save, with a sample bill drawn from
 * these choices before they are saved.
 */
export function BillLookSection({
  businessId,
  look,
  logo,
  error,
  onLook,
  onLogo,
}: {
  businessId: string;
  look: BillLook;
  logo: string | null;
  error: string | null;
  onLook: (patch: Partial<BillLook>) => void;
  onLogo: (dataUrl: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [sample, setSample] = useState<string | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);

  useEffect(() => () => void (sample && URL.revokeObjectURL(sample)), [sample]);

  async function showSample() {
    setSampleBusy(true);
    setSampleError(null);
    try {
      const res = await fetch('/api/bill-sample', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ businessId, ...look, logoDataUrl: logo }),
      });
      if (!res.ok) throw new Error(t('error.generic'));
      setSample(URL.createObjectURL(await res.blob()));
    } catch (e) {
      setSampleError(e instanceof Error ? e.message : t('error.generic'));
    } finally {
      setSampleBusy(false);
    }
  }

  return (
    <section className="card stack look" data-testid="bill-look">
      <h2 className="card__title">{t('look.title')}</h2>

      <div className="field">
        <span className="field__label">{t('look.logo')}</span>
        <div className="look__logo">
          <div className="look__logo-box" aria-hidden={!logo}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- a data URL the owner just picked
              <img src={logo} alt={t('look.logo')} />
            ) : (
              <span className="faint small">{t('look.logo')}</span>
            )}
          </div>
          <div className="stack stack--tight">
            <button type="button" id="you-logo" className="btn btn--secondary btn--small" onClick={() => fileRef.current?.click()}>
              {logo ? t('look.logo.change') : t('look.logo.add')}
            </button>
            {logo && (
              <button type="button" className="btn btn--ghost btn--small" onClick={() => onLogo(null)}>
                {t('look.logo.remove')}
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            data-testid="logo-file"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setLogoError(null);
              try {
                onLogo(await toLogo(file));
              } catch (err) {
                setLogoError(err instanceof Error ? err.message : t('look.logo.bad'));
              }
            }}
          />
        </div>
        {logoError || error ? (
          <span className="field__error" role="alert">{logoError ?? error}</span>
        ) : (
          <span className="field__hint">{t('look.logo.hint')}</span>
        )}
      </div>

      <div className="field">
        <span className="field__label" id="look-design">{t('look.design')}</span>
        <div className="look__designs" role="radiogroup" aria-labelledby="look-design">
          {BILL_DESIGNS.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={look.design === d}
              className={`look__design look__design--${d}`}
              style={{ ['--look-accent' as string]: look.accent }}
              onClick={() => onLook({ design: d })}
            >
              <span className="look__thumb" aria-hidden="true">
                <i className="look__thumb-head" />
                <i className="look__thumb-row" />
                <i className="look__thumb-row" />
                <i className="look__thumb-total" />
              </span>
              <span className="look__name">{designName(d)}</span>
              <span className="look__hint">{t(DESIGN_HINT[d])}</span>
            </button>
          ))}
        </div>
      </div>

      {look.design !== 'simple' && (
        <div className="field">
          <span className="field__label" id="look-colour">{t('look.colour')}</span>
          <div className="look__swatches" role="radiogroup" aria-labelledby="look-colour">
            {BILL_ACCENTS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={look.accent === c}
                aria-label={c}
                className="look__swatch"
                style={{ background: c }}
                onClick={() => onLook({ accent: c })}
              />
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <span className="field__label" id="look-paper">{t('look.paper')}</span>
        <div className="chips" role="radiogroup" aria-labelledby="look-paper">
          {BILL_PAPERS.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={look.paper === p} className="chip" onClick={() => onLook({ paper: p })}>
              <span className="chip__name">{paperName(p)}</span>
            </button>
          ))}
        </div>
        <span className="field__hint">{t('look.paper.hint')}</span>
      </div>

      <div className="field">
        <span className="field__label" id="look-share">{t('look.shareAs')}</span>
        <div className="chips" role="radiogroup" aria-labelledby="look-share">
          {BILL_SHARE.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={look.shareAs === s} className="chip" onClick={() => onLook({ shareAs: s })}>
              <span className="chip__name">{t(s === 'pdf' ? 'look.shareAs.pdf' : 'look.shareAs.jpg')}</span>
            </button>
          ))}
        </div>
        <span className="field__hint">{t('look.shareAs.hint')}</span>
      </div>

      <div className="stack stack--tight">
        <button type="button" className="btn btn--secondary" data-testid="look-sample" disabled={sampleBusy} onClick={() => void showSample()}>
          {sampleBusy ? <span className="spinner" aria-hidden="true" /> : null}
          {t('look.sample')}
        </button>
        <span className="faint small">{t('look.sampleNote')}</span>
        {sampleError && <span className="field__error" role="alert">{sampleError}</span>}
        {sample && (
          // eslint-disable-next-line @next/next/no-img-element -- a picture drawn on the server just now
          <img className="look__sample" src={sample} alt={t('look.sample')} data-testid="look-sample-img" />
        )}
      </div>
    </section>
  );
}
