'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Money } from '@/components/Money';
import { t } from '@/lib/copy';
import { BILL_PAPERS, BILL_SHARE, paperName, type BillPaper, type BillShareAs } from '@/lib/domain/bill-look';
import { LanguageChoice, type LanguageState } from '@/components/customer/LanguageChoice';

import { billFileUrl, fetchBillFile, saveFile } from './bill-file';

/**
 * Bill ban gaya. The next thing is WhatsApp.
 *
 * On a phone, the share sheet takes the bill and the message together and the
 * owner picks WhatsApp; that is the path that works. The bill goes as a PDF
 * or a photo, as chosen under Aap and switchable here. Where a browser cannot
 * hand a file to an app, the file is downloaded and WhatsApp opens with the
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
  /** What WhatsApp gets by default, and the paper the bill is drawn on (from Aap). */
  shareAs: BillShareAs;
  paper: BillPaper;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareAs, setShareAs] = useState<BillShareAs>(props.shareAs);
  const url = (ask: Parameters<typeof billFileUrl>[2]) => billFileUrl(props.invoiceId, props.businessId, ask);

  async function whatsapp() {
    setBusy(true);
    setNote(null);
    try {
      const file = await fetchBillFile(url({ format: shareAs }), props.number);
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], text: props.message, title: props.number });
        setNote(t('bill.done.shareOpened'));
      } else {
        saveFile(file);
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

      <div className="field">
        <span className="field__label" id="done-share-as">{t('look.shareAs')}</span>
        <div className="chips" role="radiogroup" aria-labelledby="done-share-as">
          {BILL_SHARE.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={shareAs === s} className="chip" onClick={() => setShareAs(s)}>
              <span className="chip__name">{t(s === 'pdf' ? 'look.shareAs.pdf' : 'look.shareAs.jpg')}</span>
            </button>
          ))}
        </div>
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
        <a className="btn btn--secondary grow" href={url({ format: 'pdf', download: true })}>{t('bill.done.pdf')}</a>
        <Link className="btn btn--secondary grow" href={`/bills/${props.invoiceId}`}>{t('bill.done.view')}</Link>
      </div>
      <OtherFormats url={url} current={props.paper} />
      <Link href="/home" className="btn btn--ghost" style={{ alignSelf: 'center' }}>{t('bill.done.later')}</Link>
    </div>
  );
}

/**
 * The same bill on other paper, or as a photo: for the counter printer, a
 * customer who wants A4, or one who cannot open a PDF. Folded away, because
 * most bills go out the one way chosen under Aap.
 */
export function OtherFormats({ url, current }: { url: (ask: Parameters<typeof billFileUrl>[2]) => string; current: BillPaper }) {
  return (
    <details className="card disclosure" data-testid="other-formats">
      <summary>{t('look.other')}</summary>
      <div className="disclosure__body stack stack--tight">
        {BILL_PAPERS.map((paper) => (
          <div key={paper} className="row row--between other-format">
            <span className={paper === current ? 'strong' : undefined}>{paperName(paper)}</span>
            <span className="row row--tight">
              <a className="btn btn--ghost btn--small" href={url({ paper, format: 'pdf', download: true })}>{t('look.shareAs.pdf')}</a>
              <a className="btn btn--ghost btn--small" href={url({ paper, format: 'jpg', download: true })}>{t('look.shareAs.jpg')}</a>
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}
