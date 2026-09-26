'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Money } from '@/components/Money';
import { t } from '@/lib/copy';
import { LanguageChoice, type LanguageState } from '@/components/customer/LanguageChoice';

/**
 * Bill ban gaya. The next thing is WhatsApp.
 *
 * On a phone, the share sheet takes the PDF and the message together and the
 * owner picks WhatsApp; that is the path that works. Where a browser cannot
 * hand a file to an app, the PDF is downloaded and WhatsApp opens with the
 * message, and the screen says to attach the file there. It never says the
 * bill was sent: opening a share sheet is not delivery.
 */
export function BillDone(props: {
  businessId: string;
  invoiceId: string;
  number: string;
  message: string;
  totalPaise: number;
  customerName: string;
  language: LanguageState | null;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pdfUrl = `/api/invoices/${props.invoiceId}/pdf?b=${encodeURIComponent(props.businessId)}`;

  async function whatsapp() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(pdfUrl);
      if (!res.ok) throw new Error(t('error.generic'));
      const blob = await res.blob();
      const file = new File([blob], `${props.number || 'bill'}.pdf`, { type: 'application/pdf' });
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], text: props.message, title: props.number });
        setNote(t('bill.done.shareOpened'));
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
        window.open(`https://wa.me/?text=${encodeURIComponent(props.message)}`, '_blank', 'noopener');
        setNote(t('bill.done.noShare'));
      }
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') setNote(e instanceof Error ? e.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="done">
        <div className="done__tick" aria-hidden="true">✓</div>
        <h1 className="done__title">{t('bill.done.title')}</h1>
        <p className="muted">
          {props.number} · {props.customerName} · <Money paise={props.totalPaise} whole />
        </p>
      </div>

      <button
        type="button"
        className="btn btn--whatsapp btn--block btn--large"
        disabled={busy}
        onClick={() => void whatsapp()}
      >
        {busy ? <span className="spinner" aria-hidden="true" /> : null}
        {busy ? t('bill.done.preparing') : t('bill.done.whatsapp')}
      </button>

      {note && (
        <div className="notice notice--info" role="status">
          <span className="notice__icon" aria-hidden="true">i</span>
          <span className="small">{note}</span>
        </div>
      )}

      <section className="card stack stack--tight">
        <span className="field__label">{t('bill.done.message')}</span>
        <div className="msg">{props.message}</div>
        <button
          type="button"
          className="btn btn--ghost"
          style={{ alignSelf: 'flex-start' }}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(props.message);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? t('bill.done.copied') : t('bill.done.copy')}
        </button>
      </section>

      {props.language && <LanguageChoice businessId={props.businessId} state={props.language} />}

      <div className="row row--tight">
        <a className="btn btn--secondary grow" href={`${pdfUrl}&download=1`}>{t('bill.done.pdf')}</a>
        <Link className="btn btn--secondary grow" href={`/bills/${props.invoiceId}`}>{t('bill.done.view')}</Link>
      </div>
      <Link href="/home" className="btn btn--ghost" style={{ alignSelf: 'center' }}>{t('bill.done.later')}</Link>
    </div>
  );
}
