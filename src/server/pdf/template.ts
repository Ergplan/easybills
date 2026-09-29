import 'server-only';

import { formatDateShort } from '@/lib/dates';
import { DEFAULT_LOOK, PAPER, type BillLook } from '@/lib/domain/bill-look';
import { formatPhone } from '@/lib/domain/profile';
import { amountInWords, formatMoneyIndian, formatPercentPlain, formatQuantityPlain } from '@/lib/money';
import { stateName } from '@/lib/gst/state-codes';
import type { InvoiceLine, InvoiceRecord } from '@/lib/domain/types';

/**
 * The bill as the customer gets it: three designs on A4 or A5, and a
 * one-column receipt for 80mm and 58mm counter printers.
 *
 * Everything printed comes from the invoice's OWN issued snapshot, never from
 * the live business or customer record -- so re-rendering a year-old invoice
 * reproduces exactly what the customer received, even if the business has since
 * moved, renamed itself or changed its GST registration. The design and paper
 * are only presentation: every one of them says the same thing.
 *
 * A draft renders with a DRAFT watermark and no number, because a draft is not
 * a document anyone should be able to mistake for an issued one.
 */

export interface TemplateOptions {
  upiQrDataUrl?: string | null;
  look?: BillLook;
  /** Printed across the page, for a sample that must not pass for a real bill. */
  watermark?: string;
}

function escapeHtml(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Only data: URLs for a small set of image types are allowed through.
 * A logo field is user-supplied content; without this a crafted value could
 * inject markup or point the renderer at an arbitrary URL.
 */
function safeImage(dataUrl: string | null): string | null {
  if (!dataUrl) return null;
  if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(dataUrl)) return null;
  if (dataUrl.length > 400_000) return null;
  return dataUrl;
}

function tint(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function taxableOf(l: InvoiceLine): number {
  return l.priceIncludesTax
    ? Math.round((((l.quantityMilli * l.unitPricePaise) / 1000 - l.discountPaise) * 10000) / (10000 + l.taxRateBp + l.cessRateBp))
    : Math.round((l.quantityMilli * l.unitPricePaise) / 1000) - l.discountPaise;
}

/** What every layout needs, worked out once. */
function prepare(invoice: InvoiceRecord, opts: TemplateOptions) {
  const snap = invoice.issued;
  const isDraft = invoice.status !== 'issued' || !snap;
  const seller = snap?.seller;
  const customer = snap?.customer ?? invoice.customer;
  const look = opts.look ?? DEFAULT_LOOK;
  // The colour the bill was issued with wins over today's choice, like the logo.
  const accent = /^#[0-9a-fA-F]{6}$/.test(seller?.accentColour ?? '') ? seller!.accentColour! : look.accent;
  const showGst = invoice.totals.totalTaxPaise > 0 || snap?.documentKind === 'tax-invoice';
  const totals = invoice.totals;
  const taxRows: Array<[string, number]> = [];
  if (showGst) {
    if (totals.igstPaise > 0) taxRows.push(['IGST', totals.igstPaise]);
    else {
      if (totals.cgstPaise) taxRows.push(['CGST', totals.cgstPaise]);
      if (totals.sgstPaise) taxRows.push([snap?.supplyType === 'intra-state' ? 'SGST/UTGST' : 'SGST', totals.sgstPaise]);
    }
    if (totals.cessPaise) taxRows.push(['Cess', totals.cessPaise]);
  }
  const bank = seller?.bank;
  return {
    snap,
    isDraft,
    seller,
    customer,
    look,
    accent,
    showGst,
    totals,
    taxRows,
    bank,
    hasBank: Boolean(bank && (bank.accountNumber || bank.upiId)),
    logo: safeImage(seller?.logoDataUrl ?? null),
    signature: safeImage(seller?.signatureDataUrl ?? null),
    upiQr: safeImage(opts.upiQrDataUrl ?? null),
    title: snap?.documentTitle ?? 'Draft',
    watermark: opts.watermark ?? (isDraft ? 'DRAFT' : null),
    noGstNote: snap?.documentKind === 'bill-of-supply' ? 'No GST is charged on this bill.' : null,
  };
}

export function renderInvoiceHtml(invoice: InvoiceRecord, opts: TemplateOptions = {}): string {
  const p = prepare(invoice, opts);
  return PAPER[p.look.paper].receipt ? receiptHtml(invoice, p) : pageHtml(invoice, p);
}

type Prepared = ReturnType<typeof prepare>;

// ---------------------------------------------------------------- A4 / A5 ---

function designCss(p: Prepared): string {
  const a = p.accent;
  switch (p.look.design) {
    case 'modern':
      return `
  header { background: ${a}; color: #fff; border-radius: 10px; padding: 16px 18px; margin-bottom: 16px; }
  header .muted, header .doc-meta { color: rgba(255,255,255,0.86); }
  header .doc-meta strong { color: #fff; }
  .logo { background: #fff; border-radius: 8px; padding: 6px; }
  .doc-title { color: #fff; font-size: 16pt; }
  table.items thead th { background: ${tint(a, 0.1)}; color: ${a}; border-bottom: 2px solid ${a}; }
  table.items tbody tr:nth-child(even) { background: transparent; }
  table.totals tr.grand td { background: ${a}; color: #fff; border: 0; border-radius: 6px; padding: 10px 8px; }
  table.totals tr.grand td:first-child { border-radius: 6px 0 0 6px; }
  table.totals tr.grand td:last-child { border-radius: 0 6px 6px 0; }
  .party h3, .box h3 { color: ${a}; }`;
    case 'simple':
      return `
  header { border-bottom: 1px solid #111; }
  .accent, .doc-title { color: #111; }
  table.items thead th { background: none; color: #111; border-top: 1px solid #111; border-bottom: 1px solid #111; }
  table.items tbody tr:nth-child(even) { background: transparent; }
  table.items tbody td { border-bottom: 1px solid #ddd; }
  .box { border-color: #bbb; border-radius: 0; }`;
    default:
      return `
  header { border-bottom: 2px solid ${a}; }
  .accent { color: ${a}; }
  table.items thead th { background: ${a}; color: #fff; }`;
  }
}

function pageHtml(invoice: InvoiceRecord, p: Prepared): string {
  const { seller, customer, snap, totals } = p;
  const a5 = p.look.paper === 'a5';
  const showDiscount = invoice.lines.some((l) => l.discountPaise > 0);

  const rows = invoice.lines
    .map(
      (l, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td>
            <div class="desc">${escapeHtml(l.description)}</div>
            ${l.hsnCode ? `<div class="sub">HSN/SAC ${escapeHtml(l.hsnCode)}</div>` : ''}
          </td>
          <td class="num">${escapeHtml(formatQuantityPlain(l.quantityMilli))}${l.unit ? ` ${escapeHtml(l.unit)}` : ''}</td>
          <td class="num">${formatMoneyIndian(l.unitPricePaise)}</td>
          ${showDiscount ? `<td class="num">${l.discountPaise ? formatMoneyIndian(l.discountPaise) : '—'}</td>` : ''}
          ${p.showGst ? `<td class="num">${escapeHtml(formatPercentPlain(l.taxRateBp))}%</td>` : ''}
          <td class="num">${formatMoneyIndian(taxableOf(l))}</td>
        </tr>`,
    )
    .join('');

  const totalsRows: string[] = [`<tr><td>Items total</td><td class="num">${formatMoneyIndian(totals.subtotalPaise)}</td></tr>`];
  if (totals.totalDiscountPaise > 0) {
    totalsRows.push(`<tr><td>Discount</td><td class="num">− ${formatMoneyIndian(totals.totalDiscountPaise)}</td></tr>`);
  }
  if (p.showGst) {
    totalsRows.push(`<tr><td>Taxable value</td><td class="num">${formatMoneyIndian(totals.taxableValuePaise)}</td></tr>`);
    for (const [label, paise] of p.taxRows) totalsRows.push(`<tr><td>${label}</td><td class="num">${formatMoneyIndian(paise)}</td></tr>`);
  }
  if (totals.roundOffPaise !== 0) {
    const sign = totals.roundOffPaise > 0 ? '+' : '−';
    totalsRows.push(`<tr><td>Rounded off</td><td class="num">${sign} ${formatMoneyIndian(Math.abs(totals.roundOffPaise))}</td></tr>`);
  }
  const bank = p.bank;

  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(p.title)} ${escapeHtml(invoice.number ?? '')}</title>
<style>
  @page { size: ${a5 ? 'A5' : 'A4'}; margin: ${a5 ? '10mm 9mm' : '14mm 12mm'}; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: ${a5 ? '9pt' : '10.5pt'}; color: #1a1a1a; margin: 0; line-height: 1.45; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  /* The photo version is a screen, not a page: give it the page's margins. */
  @media screen { body { padding: ${a5 ? '9mm' : '12mm'}; } }
  header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start;
           padding-bottom: 10px; margin-bottom: 14px; }
  .logo { max-height: ${a5 ? '48px' : '64px'}; max-width: 180px; object-fit: contain; display: block; margin-bottom: 6px; }
  .seller-name { font-size: ${a5 ? '12.5pt' : '15pt'}; font-weight: 700; margin: 0 0 2px; }
  .muted { color: #555; font-size: 0.9em; }
  .doc-title { font-size: ${a5 ? '11pt' : '13pt'}; font-weight: 700; text-align: right; text-transform: uppercase; letter-spacing: 0.04em; }
  .doc-meta { text-align: right; font-size: 0.9em; color: #444; margin-top: 4px; }
  .doc-meta strong { color: #1a1a1a; }
  .parties { display: flex; gap: 20px; margin-bottom: 14px; }
  .party { flex: 1; }
  .party h3, .box h3 { font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.06em; color: #666; margin: 0 0 4px; font-weight: 700; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  table.items thead th { font-size: 0.85em; text-align: left; padding: 7px 8px; font-weight: 600; }
  table.items thead th.num { text-align: right; }
  table.items tbody td { padding: 7px 8px; border-bottom: 1px solid #e4e4e4; vertical-align: top; }
  table.items tbody tr:nth-child(even) { background: #fafafa; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .desc { font-weight: 500; }
  .sub { font-size: 0.8em; color: #666; }
  .foot { display: flex; gap: 20px; align-items: flex-start; }
  .foot-left { flex: 1.3; }
  .foot-right { flex: 1; }
  table.totals { width: 100%; border-collapse: collapse; }
  table.totals td { padding: 5px 8px; }
  table.totals td.num { text-align: right; }
  table.totals tr.grand td { border-top: 2px solid #1a1a1a; font-size: 1.15em; font-weight: 700; padding-top: 8px; }
  .words { margin-top: 8px; font-size: 0.9em; color: #333; font-style: italic; }
  .nogst { margin-top: 6px; font-size: 0.85em; color: #555; }
  .box { border: 1px solid #ddd; border-radius: 6px; padding: 9px 11px; margin-bottom: 10px; }
  .box .line { font-size: 0.9em; }
  .sign { margin-top: 18px; text-align: right; }
  .sign img { max-height: 52px; max-width: 150px; }
  .sign .rule { border-top: 1px solid #999; width: 170px; margin: 4px 0 0 auto; padding-top: 3px; font-size: 0.85em; color: #555; }
  .qr { width: ${a5 ? '88px' : '104px'}; height: ${a5 ? '88px' : '104px'}; object-fit: contain; }
  .watermark {
    position: fixed; top: 42%; left: 50%; transform: translate(-50%, -50%) rotate(-28deg);
    font-size: ${a5 ? '56pt' : '78pt'}; font-weight: 800; color: rgba(190, 40, 30, 0.13); letter-spacing: 0.08em;
    z-index: 0; pointer-events: none;
  }
  .content { position: relative; z-index: 1; }
  .note { margin-top: 10px; font-size: 0.9em; color: #444; white-space: pre-wrap; }
  .legal { margin-top: 14px; padding-top: 8px; border-top: 1px solid #e4e4e4; font-size: 0.75em; color: #777; }
  /* Repeat the header row when a long bill runs onto a second page. */
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
${designCss(p)}
</style>
</head>
<body class="design-${p.look.design} paper-${p.look.paper}">
${p.watermark ? `<div class="watermark">${escapeHtml(p.watermark)}</div>` : ''}
<div class="content">

  <header>
    <div>
      ${p.logo ? `<img class="logo" src="${p.logo}" alt="">` : ''}
      <p class="seller-name">${escapeHtml(seller?.legalName ?? 'Your business')}</p>
      ${seller?.tradeName ? `<div class="muted">${escapeHtml(seller.tradeName)}</div>` : ''}
      <div class="muted">
        ${[seller?.addressLine1, seller?.addressLine2, seller?.city, seller?.pincode].filter(Boolean).map(escapeHtml).join(', ')}
        ${seller?.stateCode ? `<br>${escapeHtml(stateName(seller.stateCode))}` : ''}
      </div>
      <div class="muted">
        ${seller?.gstin ? `GSTIN: <strong>${escapeHtml(seller.gstin)}</strong><br>` : ''}
        ${seller?.pan ? `PAN: ${escapeHtml(seller.pan)}<br>` : ''}
        ${seller?.phone ? `${escapeHtml(formatPhone(seller.phone) || seller.phone)}` : ''}${seller?.email ? ` · ${escapeHtml(seller.email)}` : ''}
      </div>
    </div>
    <div>
      <div class="doc-title accent">${escapeHtml(p.title)}</div>
      <div class="doc-meta">
        ${invoice.number ? `No. <strong>${escapeHtml(invoice.number)}</strong><br>` : 'Not yet issued<br>'}
        Date: <strong>${escapeHtml(formatDateShort(invoice.issueDate))}</strong>
        ${invoice.dueDate ? `<br>Due: ${escapeHtml(formatDateShort(invoice.dueDate))}` : ''}
        ${invoice.billingPeriod ? `<br>Period: ${escapeHtml(formatDateShort(invoice.billingPeriod.from))} – ${escapeHtml(formatDateShort(invoice.billingPeriod.to))}` : ''}
      </div>
    </div>
  </header>

  <div class="parties">
    <div class="party">
      <h3>Bill to</h3>
      <div><strong>${escapeHtml(customer.name)}</strong></div>
      <div class="muted">
        ${[customer.addressLine1, customer.addressLine2, customer.city, customer.pincode].filter(Boolean).map(escapeHtml).join(', ')}
        ${customer.stateCode ? `<br>${escapeHtml(stateName(customer.stateCode))}` : ''}
        ${customer.gstin ? `<br>GSTIN: ${escapeHtml(customer.gstin)}` : ''}
        ${customer.phone ? `<br>${escapeHtml(formatPhone(customer.phone) || customer.phone)}` : ''}
      </div>
    </div>
    ${
      p.showGst && snap?.placeOfSupplyStateCode
        ? `<div class="party">
             <h3>Place of supply</h3>
             <div>${escapeHtml(stateName(snap.placeOfSupplyStateCode))}</div>
             <div class="muted">${snap.supplyType === 'intra-state' ? 'Within state' : 'Interstate'}</div>
           </div>`
        : ''
    }
  </div>

  <table class="items">
    <thead>
      <tr>
        <th class="num">#</th>
        <th>Description</th>
        <th class="num">Qty</th>
        <th class="num">Rate</th>
        ${showDiscount ? '<th class="num">Discount</th>' : ''}
        ${p.showGst ? '<th class="num">GST</th>' : ''}
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="foot">
    <div class="foot-left">
      ${
        p.hasBank
          ? `<div class="box">
               <h3>How to pay</h3>
               ${bank!.accountHolderName ? `<div class="line">${escapeHtml(bank!.accountHolderName)}</div>` : ''}
               ${bank!.bankName ? `<div class="line">${escapeHtml(bank!.bankName)}</div>` : ''}
               ${bank!.accountNumber ? `<div class="line">A/c: ${escapeHtml(bank!.accountNumber)}</div>` : ''}
               ${bank!.ifsc ? `<div class="line">IFSC: ${escapeHtml(bank!.ifsc)}</div>` : ''}
               ${bank!.upiId ? `<div class="line">UPI: ${escapeHtml(bank!.upiId)}</div>` : ''}
             </div>`
          : ''
      }
      ${p.upiQr ? `<img class="qr" src="${p.upiQr}" alt="UPI payment QR code">` : ''}
      ${invoice.notes ? `<div class="note">${escapeHtml(invoice.notes)}</div>` : ''}
    </div>

    <div class="foot-right">
      <table class="totals">
        ${totalsRows.join('')}
        <tr class="grand">
          <td>Total</td>
          <td class="num">${formatMoneyIndian(totals.grandTotalPaise, { withSymbol: true })}</td>
        </tr>
      </table>
      <div class="words">${escapeHtml(amountInWords(totals.grandTotalPaise))}</div>
      ${p.noGstNote ? `<div class="nogst">${p.noGstNote}</div>` : ''}

      <div class="sign">
        ${p.signature ? `<img src="${p.signature}" alt="">` : ''}
        <div class="rule">For ${escapeHtml(seller?.legalName ?? '')}</div>
      </div>
    </div>
  </div>

  <div class="legal">
    ${p.upiQr ? 'The QR code above is a UPI payment code. It is not a government e-invoice QR code. ' : ''}This document was prepared with EkBill.
  </div>

</div>
</body>
</html>`;
}

// ---------------------------------------------------------------- receipt ---

/**
 * The counter printer's version: one column, centred header, each item on
 * two lines (what, then qty x rate = amount), totals, the UPI code. Black on
 * white whatever the design, because a thermal printer has one colour.
 */
function receiptHtml(invoice: InvoiceRecord, p: Prepared): string {
  const { seller, customer, totals } = p;
  const narrow = p.look.paper === '58mm';
  const widthMm = PAPER[p.look.paper].widthMm;
  const mixedRates = new Set(invoice.lines.map((l) => l.taxRateBp)).size > 1;

  const items = invoice.lines
    .map(
      (l) => `
      <div class="item">
        <div class="item__what">${escapeHtml(l.description)}</div>
        <div class="row"><span>${escapeHtml(formatQuantityPlain(l.quantityMilli))}${l.unit ? ` ${escapeHtml(l.unit)}` : ''} x ${formatMoneyIndian(l.unitPricePaise)}${
          p.showGst && mixedRates ? ` · GST ${escapeHtml(formatPercentPlain(l.taxRateBp))}%` : ''
        }</span><span>${formatMoneyIndian(taxableOf(l))}</span></div>
      </div>`,
    )
    .join('');

  const sums: string[] = [];
  if (p.showGst) {
    sums.push(row('Taxable', formatMoneyIndian(totals.taxableValuePaise)));
    // One rate on the bill: say it next to each tax ("CGST 9%"). Several: the lines say theirs.
    const oneRate = !mixedRates ? (invoice.lines[0]?.taxRateBp ?? 0) : 0;
    for (const [label, paise] of p.taxRows) {
      const rateBp = !oneRate || label === 'Cess' ? 0 : label === 'IGST' ? oneRate : oneRate / 2;
      sums.push(row(rateBp ? `${label} ${formatPercentPlain(rateBp)}%` : label, formatMoneyIndian(paise)));
    }
  } else if (totals.totalDiscountPaise > 0) {
    sums.push(row('Items', formatMoneyIndian(totals.subtotalPaise)));
  }
  if (totals.totalDiscountPaise > 0) sums.push(row('Discount', `− ${formatMoneyIndian(totals.totalDiscountPaise)}`));
  if (totals.roundOffPaise !== 0) sums.push(row('Round off', `${totals.roundOffPaise > 0 ? '+' : '−'} ${formatMoneyIndian(Math.abs(totals.roundOffPaise))}`));

  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(p.title)} ${escapeHtml(invoice.number ?? '')}</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; }
  body {
    width: ${widthMm}mm; padding: ${narrow ? '3mm 2.5mm' : '4mm 4mm'};
    font-family: "DejaVu Sans Condensed", "Arial Narrow", "Roboto Condensed", Arial, sans-serif;
    font-size: ${narrow ? '7.6pt' : '8.8pt'}; line-height: 1.35; color: #000;
  }
  .c { text-align: center; }
  .logo { max-width: 70%; max-height: ${narrow ? '14mm' : '18mm'}; object-fit: contain; display: block; margin: 0 auto 2mm; filter: grayscale(1); }
  .shop { font-size: 1.35em; font-weight: 800; }
  .small { font-size: 0.9em; }
  .title { font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; margin: 1.5mm 0; }
  hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
  hr.solid { border-top: 1.5px solid #000; }
  .row { display: flex; justify-content: space-between; gap: 2mm; }
  .row span:last-child { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .item { margin-bottom: 1.4mm; }
  .item__what { font-weight: 600; word-break: break-word; }
  .grand { font-size: 1.3em; font-weight: 800; }
  .words { font-style: italic; margin-top: 1mm; }
  .qr { width: ${narrow ? '26mm' : '32mm'}; height: ${narrow ? '26mm' : '32mm'}; display: block; margin: 1mm auto; }
  .watermark { text-align: center; font-weight: 800; border: 1.5px solid #000; padding: 1mm; margin-bottom: 2mm; letter-spacing: 0.1em; }
</style>
</head>
<body class="receipt paper-${p.look.paper}">
  ${p.watermark ? `<div class="watermark">${escapeHtml(p.watermark)}</div>` : ''}
  <div class="c">
    ${p.logo ? `<img class="logo" src="${p.logo}" alt="">` : ''}
    <div class="shop">${escapeHtml(seller?.legalName ?? 'Your business')}</div>
    <div class="small">${[seller?.addressLine1, seller?.city, seller?.pincode].filter(Boolean).map(escapeHtml).join(', ')}</div>
    ${seller?.gstin ? `<div class="small">GSTIN: ${escapeHtml(seller.gstin)}</div>` : ''}
    ${seller?.phone ? `<div class="small">Ph: ${escapeHtml(formatPhone(seller.phone) || seller.phone)}</div>` : ''}
    <div class="title">${escapeHtml(p.title)}</div>
  </div>
  <div class="row"><span>${invoice.number ? `No. ${escapeHtml(invoice.number)}` : 'Not yet issued'}</span><span>${escapeHtml(formatDateShort(invoice.issueDate))}</span></div>
  <div>To: <strong>${escapeHtml(customer.name)}</strong></div>
  ${customer.gstin ? `<div class="small">GSTIN: ${escapeHtml(customer.gstin)}</div>` : ''}
  <hr>
  ${items}
  <hr>
  ${sums.join('')}
  ${sums.length ? '<hr class="solid">' : ''}
  <div class="row grand"><span>TOTAL</span><span>${formatMoneyIndian(totals.grandTotalPaise, { withSymbol: true })}</span></div>
  <div class="words small">${escapeHtml(amountInWords(totals.grandTotalPaise))}</div>
  ${p.noGstNote ? `<div class="small">${p.noGstNote}</div>` : ''}
  ${
    p.upiQr || p.bank?.upiId
      ? `<hr>${p.upiQr ? `<img class="qr" src="${p.upiQr}" alt="UPI payment QR code">` : ''}${
          p.bank?.upiId ? `<div class="c small">UPI: ${escapeHtml(p.bank.upiId)}</div>` : ''
        }${p.upiQr ? '<div class="c small">UPI payment code, not a government e-invoice QR code.</div>' : ''}`
      : ''
  }
  <hr>
  <div class="c">Thank you! Dhanyavaad</div>
  <div class="c small">Prepared with EkBill</div>
</body>
</html>`;
}

function row(label: string, value: string): string {
  return `<div class="row"><span>${escapeHtml(label)}</span><span>${value}</span></div>`;
}
