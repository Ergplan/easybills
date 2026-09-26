'use client';

import { useState } from 'react';

import { t } from '@/lib/copy';

/**
 * "CA ko bhejo." The pack is fetched, then handed to the phone's share
 * sheet so the owner picks WhatsApp or email; where there is no share
 * sheet it downloads, and the screen says what to do with it.
 */
export function GstSend({ businessId, month, label }: { businessId: string; month: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const url = `/api/gst/quarter?b=${encodeURIComponent(businessId)}&q=${encodeURIComponent(month)}`;

  async function send() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(t('error.generic'));
      const blob = await res.blob();
      const file = new File([blob], `gst-${label.replace(/[^A-Za-z0-9-]+/g, '-')}.zip`, { type: 'application/zip' });
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: `GST ${label}` });
        setNote(t('gst.shareOpened'));
      } else {
        const href = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(href);
        setNote(t('gst.downloaded'));
      }
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') setNote(e instanceof Error ? e.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack stack--tight">
      <button type="button" className="btn btn--primary btn--block btn--large" disabled={busy} data-pack={url} onClick={() => void send()}>
        {busy ? <span className="spinner" aria-hidden="true" /> : null}
        {busy ? t('gst.preparing') : t('gst.send')}
      </button>
      <p className="faint" style={{ textAlign: 'center' }}>{t('gst.sendNote')}</p>
      {note && (
        <div className="notice notice--info" role="status">
          <span className="notice__icon" aria-hidden="true">i</span>
          <span className="small">{note}</span>
        </div>
      )}
    </div>
  );
}
