'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { askAction } from '@/app/actions/ask';
import { t } from '@/lib/copy';
import type { AskResult } from '@/server/search/ask';

const TRIES = ['ask.try1', 'ask.try2', 'ask.try3'] as const;

export function AskBox({ businessId, withModel, initial }: { businessId: string; withModel: boolean; initial: string }) {
  const [question, setQuestion] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(false);

  async function ask(q: string) {
    if (!q.trim()) {
      setError(t('ask.empty'));
      return;
    }
    setBusy(true);
    setError(null);
    const r = await askAction(businessId, q);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setResult(r.data);
  }

  // Arriving with ?q= (from voice, or a link) asks straight away, once.
  useEffect(() => {
    if (initial && !asked.current) {
      asked.current = true;
      void ask(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  return (
    <div className="stack">
      <form
        className="card stack stack--tight"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor="ask-q" className="field__label">{t('ask.label')}</label>
        <textarea
          id="ask-q"
          className="textarea"
          rows={2}
          maxLength={500}
          value={question}
          placeholder={t('ask.placeholder')}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask(question);
            }
          }}
        />
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? <span className="spinner" aria-hidden="true" /> : null}
          {busy ? t('ask.thinking') : t('ask.go')}
        </button>
        {!result && (
          <div className="chips">
            {TRIES.map((k) => (
              <button
                key={k}
                type="button"
                className="chip"
                onClick={() => {
                  setQuestion(t(k));
                  void ask(t(k));
                }}
              >
                {t(k)}
              </button>
            ))}
          </div>
        )}
        {error && <p className="field__error" role="alert">{error}</p>}
      </form>

      {result && (
        <section className="card stack stack--tight" aria-live="polite" data-testid="ask-result">
          {result.mode === 'nothing' && <p>{t('ask.nothing')}</p>}
          {result.answer && <p className="ask__answer">{result.answer}</p>}
          {result.mode === 'search' && (
            <p className="muted small">{withModel ? t('ask.found') : `${t('ask.noModel')} ${t('ask.found')}`}</p>
          )}
          {result.sources.length > 0 && (
            <ol className="ask__sources">
              {result.sources.map((s, i) => (
                <li key={`${s.documentId}#${s.ord}`} className="small">
                  {result.answer ? <span className="faint">[{i + 1}] </span> : null}
                  {s.href ? <Link href={s.href}>{s.title}</Link> : <strong>{s.title}</strong>}
                  <div className="faint ask__snippet">{s.text.slice(0, 220)}{s.text.length > 220 ? '…' : ''}</div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
