'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { importCustomersAction } from '@/app/actions/customers';
import { t } from '@/lib/copy';
import { moneyForMessage } from '@/lib/copy/messages';
import { formatDateShort } from '@/lib/dates';
import type { ImportedCustomer } from '@/lib/import/types';

interface Reading {
  filename: string;
  kind: string;
  customers: ImportedCustomer[];
  existing: Array<string | null>;
  problem: 'no-text' | 'scanned' | 'unrecognised' | 'unsupported' | 'too-big' | null;
}

interface Row {
  key: string;
  file: string;
  c: ImportedCustomer;
  existing: boolean;
  picked: boolean;
}

/**
 * "Purane bills upload karo." The owner with ten customers on old bills
 * should not type ten names. The files are read on the server and come
 * back as candidates, each with where it was read from; the owner unticks
 * the wrong ones, fixes a name, and adds the rest. Nothing is added by
 * the upload itself.
 */
export function ImportBills({ businessId }: { businessId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const form = new FormData();
      form.set('b', businessId);
      for (const f of Array.from(files).slice(0, 10)) form.append('files', f);
      const res = await fetch('/api/import/bills', { method: 'POST', body: form });
      if (!res.ok) throw new Error(t('error.generic'));
      const body = (await res.json()) as { readings: Reading[] };
      setReadings(body.readings);
      setRows(
        body.readings.flatMap((r) =>
          r.customers.map((c, i) => ({
            key: `${r.filename}#${i}`,
            file: r.filename,
            c,
            existing: Boolean(r.existing[i]),
            picked: !r.existing[i],
          })),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error.generic'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function add() {
    const chosen = rows.filter((r) => r.picked);
    if (!chosen.length) return;
    setBusy(true);
    setError(null);
    const r = await importCustomersAction(
      businessId,
      chosen.map(({ c }) => ({
        name: c.name,
        contactPerson: c.contactPerson,
        phone: c.phone,
        gstin: c.gstin,
        pan: c.pan,
        addressLine1: c.addressLine1,
        city: c.city,
        pincode: c.pincode,
        stateCode: c.stateCode,
      })),
    );
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const skippedNote = r.data.skipped.length ? ` ${r.data.skipped.map((s) => `${s.name}: ${s.reason}`).join(' · ')}` : '';
    setDone(t('import.added', { n: r.data.added }) + skippedNote);
    setRows([]);
    setReadings([]);
    router.refresh();
  }

  const pickedCount = rows.filter((r) => r.picked).length;

  return (
    <section className="card stack">
      <div>
        <h2 className="card__title" style={{ fontSize: '1.15rem' }}>{t('import.title')}</h2>
        <p className="card__sub">{t('import.sub')}</p>
      </div>
      <input
        ref={input}
        id="import-files"
        type="file"
        multiple
        accept=".pdf,.csv,.xlsx,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        onChange={(e) => void upload(e.target.files)}
      />
      <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <span className="spinner" aria-hidden="true" /> : null}
        {busy ? t('import.reading') : t('import.pick')}
      </button>

      {readings.map((r) => (
        <div key={r.filename} className="small">
          <strong>{r.filename}</strong>
          {' · '}
          {r.problem ? (
            <span style={{ color: 'var(--warn)' }}>{t(`import.problem.${r.problem}` as const)}</span>
          ) : r.customers.length === 0 ? (
            t('import.foundNone')
          ) : r.customers.length === 1 ? (
            t('import.foundOne')
          ) : (
            t('import.found', { n: r.customers.length })
          )}
        </div>
      ))}

      {rows.length > 0 && (
        <div className="rows">
          {rows.map((row) => (
            <label key={row.key} className="row-line import-row">
              <input
                type="checkbox"
                checked={row.picked}
                onChange={(e) => setRows((rs) => rs.map((x) => (x.key === row.key ? { ...x, picked: e.target.checked } : x)))}
              />
              <div className="row-line__link" style={{ gap: 2 }}>
                <input
                  className="input import-row__name"
                  value={row.c.name}
                  aria-label={t('customer.name')}
                  onChange={(e) => setRows((rs) => rs.map((x) => (x.key === row.key ? { ...x, c: { ...x.c, name: e.target.value } } : x)))}
                />
                <div className="row-line__meta">
                  {[row.c.gstin, row.c.phone, row.c.city].filter(Boolean).join(' · ')}
                  {row.c.bill && (
                    <>
                      {row.c.gstin || row.c.phone || row.c.city ? ' · ' : ''}
                      {t('import.billMeta', {
                        number: row.c.bill.number ?? '—',
                        date: row.c.bill.date ? formatDateShort(row.c.bill.date) : '—',
                        amount: row.c.bill.totalPaise !== null ? moneyForMessage(row.c.bill.totalPaise) : '—',
                      })}
                    </>
                  )}
                </div>
                <div className="row-line__meta">
                  {t('import.from', { source: row.c.source })}
                  {row.existing && <span className="pill pill--paid" style={{ marginLeft: 6 }}>{t('import.already')}</span>}
                  {row.c.confidence === 'low' && <span className="pill pill--partly" style={{ marginLeft: 6 }}>{t('import.lowConfidence')}</span>}
                </div>
              </div>
            </label>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <button type="button" className="btn btn--primary btn--block" disabled={busy || pickedCount === 0} onClick={() => void add()}>
          {busy ? <span className="spinner" aria-hidden="true" /> : null}
          {pickedCount === 1 ? t('import.addOne') : t('import.add', { n: pickedCount })}
        </button>
      )}

      {done && (
        <div className="notice notice--ok" role="status">
          <span className="notice__icon" aria-hidden="true">✓</span>
          <span className="small">{done}</span>
        </div>
      )}
      {error && (
        <div className="notice notice--danger" role="alert">
          <span className="notice__icon" aria-hidden="true">!</span>
          <span className="small">{error}</span>
        </div>
      )}
      <p className="faint">{t('import.note')}</p>
    </section>
  );
}
