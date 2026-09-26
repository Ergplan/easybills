'use client';

import Link from 'next/link';
import { useState } from 'react';

import { noteReminderAction } from '@/app/actions/invoices';
import { t } from '@/lib/copy';
import type { ReminderTone } from '@/lib/copy/messages';
import { whatsappLink } from '@/lib/domain/whatsapp';

const TONES: Array<{ key: ReminderTone; label: 'remind.tone.gentle' | 'remind.tone.direct' | 'remind.tone.second' }> = [
  { key: 'gentle', label: 'remind.tone.gentle' },
  { key: 'direct', label: 'remind.tone.direct' },
  { key: 'second', label: 'remind.tone.second' },
];

/**
 * The reminder, written for them.
 *
 * The message is drafted in the customer's language from the bill and the
 * tone, and the owner can change a word before it goes. "WhatsApp kholo"
 * hands the PDF and the text to the share sheet on a phone; elsewhere it
 * opens the customer's chat with the text typed in and downloads the PDF to
 * attach. Either way the app counts the tap, not a delivery it cannot see.
 */
export function RemindScreen(props: {
  businessId: string;
  invoiceId: string;
  number: string;
  customerPhone: string | null;
  suggested: ReminderTone;
  drafts: Record<ReminderTone, string>;
  remindersSent: number;
  lastRemindedAt: string | null;
}) {
  const [tone, setTone] = useState<ReminderTone>(props.suggested);
  const [text, setText] = useState(props.drafts[props.suggested]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const pdfUrl = `/api/invoices/${props.invoiceId}/pdf?b=${encodeURIComponent(props.businessId)}`;

  async function go() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(pdfUrl);
      if (!res.ok) throw new Error(t('error.generic'));
      const blob = await res.blob();
      const file = new File([blob], `${props.number || 'bill'}.pdf`, { type: 'application/pdf' });
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], text, title: props.number });
        setNote(t('remind.opened'));
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
        window.open(whatsappLink(props.customerPhone, text), '_blank', 'noopener');
        setNote(props.customerPhone ? t('bill.done.noShare') : t('remind.noPhone'));
      }
      void noteReminderAction(props.businessId, props.invoiceId);
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') setNote(e instanceof Error ? e.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {props.remindersSent > 0 && (
        <p className="faint">
          {props.remindersSent === 1
            ? t('remind.beforeOne', { when: props.lastRemindedAt?.slice(0, 10) ?? '' })
            : t('remind.before', { n: props.remindersSent, when: props.lastRemindedAt?.slice(0, 10) ?? '' })}
        </p>
      )}

      <section className="card stack stack--tight">
        <span className="field__label">{t('remind.tone')}</span>
        <div className="chips" role="group" aria-label={t('remind.tone')}>
          {TONES.map((tn) => (
            <button
              key={tn.key}
              type="button"
              className="chip"
              aria-pressed={tone === tn.key}
              onClick={() => {
                setTone(tn.key);
                setText(props.drafts[tn.key]);
              }}
            >
              <span className="chip__name">{t(tn.label)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card stack stack--tight">
        <span className="faint">{t('remind.note')}</span>
        <textarea
          id="remind-text"
          className="textarea msg"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={t('remind.note')}
        />
        <div className="row row--tight">
          <span className="pdf-chip" aria-hidden="true">PDF</span>
          <div className="grow small">
            <strong>{props.number}.pdf</strong>
            <div className="faint">{t('remind.attached')}</div>
          </div>
        </div>
      </section>

      {note && (
        <div className="notice notice--info" role="status">
          <span className="notice__icon" aria-hidden="true">i</span>
          <span className="small">{note}</span>
        </div>
      )}

      <button type="button" className="btn btn--whatsapp btn--block btn--large" disabled={busy} onClick={() => void go()}>
        {busy ? <span className="spinner" aria-hidden="true" /> : null}
        {t('remind.go')}
      </button>
      <Link href={`/bills/${props.invoiceId}`} className="btn btn--ghost" style={{ alignSelf: 'center' }}>
        {t('remind.markPaid')}
      </Link>
    </div>
  );
}
