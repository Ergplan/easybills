'use client';

import { useState } from 'react';

import { formatMoneyIndian } from '@/lib/money';
import { formatDateShort } from '@/lib/dates';
import type { InvoiceRecord } from '@/lib/domain/types';

/**
 * Sharing, honestly.
 *
 * THE RULE THIS SCREEN KEEPS: opening a share sheet is not delivery. This app
 * has no configured email or WhatsApp delivery service, so it never says a bill
 * was "sent". It hands the owner the PDF, or hands the file to the device's own
 * share sheet, and then says exactly that. The bill's status is unaffected.
 *
 * The customer needs no account to receive the PDF: they receive a file.
 */
export function ShareActions({ businessId, invoice }: { businessId: string; invoice: InvoiceRecord }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pdfUrl = `/api/invoices/${invoice.id}/pdf?b=${encodeURIComponent(businessId)}`;

  const messageText = [
    `${invoice.issued?.documentTitle ?? 'Bill'} ${invoice.number ?? ''}`.trim(),
    `${invoice.issued?.seller.legalName ?? ''}`,
    `Amount: ${formatMoneyIndian(invoice.totals.grandTotalPaise, { withSymbol: true })}`,
    invoice.dueDate ? `Due: ${formatDateShort(invoice.dueDate)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  async function shareFile() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(pdfUrl);
      if (!res.ok) throw new Error('Could not prepare the PDF.');
      const blob = await res.blob();
      const file = new File([blob], `${invoice.number ?? 'bill'}.pdf`, { type: 'application/pdf' });

      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], text: messageText, title: `Bill ${invoice.number ?? ''}` });
        // Deliberately does NOT claim the bill was sent: the share sheet opening
        // tells us nothing about whether the owner actually sent it.
        setNote('Your phone’s share options were opened. We cannot tell whether it was sent, so the bill still shows as unpaid until you record a payment.');
      } else {
        // No share sheet: fall back to a download, and say so plainly.
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${invoice.number ?? 'bill'}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        setNote('The PDF has been downloaded. You can attach it to WhatsApp or email yourself.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare the PDF. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="share-heading">
      <h2 id="share-heading">Share this bill</h2>

      <button type="button" className="btn btn--primary btn--block btn--large" disabled={busy} onClick={() => void shareFile()}>
        {busy ? <span className="spinner" aria-hidden="true" /> : null}
        Share PDF
      </button>

      <div className="row row--tight">
        <a className="btn btn--secondary grow" href={pdfUrl} target="_blank" rel="noopener noreferrer">
          View PDF
        </a>
        <a className="btn btn--secondary grow" href={`${pdfUrl}&download=1`}>
          Download
        </a>
      </div>

      {note && (
        <div className="notice notice--info" role="status">
          <span className="notice__icon" aria-hidden="true">i</span>
          <span className="small">{note}</span>
        </div>
      )}
      {error && (
        <div className="notice notice--danger" role="alert">
          <span className="notice__icon" aria-hidden="true">!</span>
          <span className="small">{error}</span>
        </div>
      )}

      <p className="tiny muted">
        Your customer does not need an account to open the PDF.
      </p>
    </section>
  );
}
