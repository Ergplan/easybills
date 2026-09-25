'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createBusinessAction } from '@/app/actions/business';
import { seedDemoBusinessAction } from '@/app/actions/demo';

export function StartForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="stack">
      <form
        className="card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const r = await createBusinessAction(name);
          setBusy(false);
          if (r.ok) {
            router.replace('/home');
            router.refresh();
          } else {
            setError(r.error);
          }
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="biz-name">Business name</label>
          <input
            id="biz-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Kumar Electrical Repairs"
            autoFocus
            required
            maxLength={200}
          />
        </div>
        {error && <p className="field__error" role="alert">{error}</p>}
        <button type="submit" className="btn btn--primary btn--block btn--large" disabled={busy || !name.trim()}>
          {busy ? 'Setting up…' : 'Start billing'}
        </button>
      </form>

      <div className="card stack">
        <h2 style={{ fontSize: '1rem' }}>Just looking around?</h2>
        <p className="muted small">
          We can set up a demo business with sample customers and bills. It is kept completely separate from any
          real business you create, and is labelled as a demo everywhere.
        </p>
        <button
          type="button"
          className="btn btn--secondary btn--block"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await seedDemoBusinessAction();
            setBusy(false);
            if (r.ok) {
              router.replace('/home');
              router.refresh();
            } else setError(r.error);
          }}
        >
          Try a demo business
        </button>
      </div>
    </div>
  );
}
