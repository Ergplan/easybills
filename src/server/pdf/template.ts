import 'server-only';

import { formatDateShort } from '@/lib/dates';
import { amountInWords, formatMoneyIndian, formatPercentPlain, formatQuantityPlain } from '@/lib/money';
import { stateName } from '@/lib/gst/state-codes';
import type { InvoiceRecord } from '@/lib/domain/types';

/**
 * One clean A4 invoice template. No marketplace, no layout designer.
 *
 * Everything printed comes from the invoice's OWN issued snapshot, never from
 * the live business or customer record -- so re-rendering a year-old invoice
 * reproduces exactly what the customer received, even if the business has since
 * moved, renamed itself or changed its GST registration.
 *
 * A draft renders with a DRAFT watermark and no number, because a draft is not
 * a document anyone should be able to mistake for an issued one.
 */

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

export function renderInvoiceHtml(invoice: InvoiceRecord, opts: { upiQrDataUrl?: string | null } = {}): string {
  const snap = invoice.issued;
  const isDraft = invoice.status !== 'issued' || !snap;

  const seller = snap?.seller;
  const customer = snap?.customer ?? invoice.customer;
  const accent = /^#[0-9a-fA-F]{6}$/.test(seller?.accentColour ?? '') ? seller!.accentColour! : '#2f4a9e';
  const logo = safeImage(seller?.logoDataUrl ?? null);
  const signature = safeImage(seller?.signatureDataUrl ?? null);
  const upiQr = safeImage(opts.upiQrDataUrl ?? null);

  const showGst = invoice.totals.totalTaxPaise > 0 || snap?.documentKind === 'tax-invoice';
  const isIgst = invoice.totals.igstPaise > 0;
  const stateTaxLabel = snap?.supplyType === 'intra-state' ? 'SGST/UTGST' : 'SGST';

  const rows = invoice.lines
    .map((l, i) => {
      const taxable = l.priceIncludesTax
        ? Math.round(((l.quantityMilli * l.unitPricePaise) / 1000 - l.discountPaise) * 10000 / (10000 + l.taxRateBp + l.cessRateBp))
        : Math.round((l.quantityMilli * l.unitPricePaise) / 1000) - l.discountPaise;
      return `
        <tr>
          <td class="num">${i + 1}</td>
          <td>
            <div class="desc">${escapeHtml(l.description)}</div>
            ${l.hsnCode ? `<div class="sub">HSN/SAC ${escapeHtml(l.hsnCode)}</div>` : ''}
          </td>
          <td class="num">${escapeHtml(formatQuantityPlain(l.quantityMilli))}${l.unit ? ` ${escapeHtml(l.unit)}` : ''}</td>
          <td class="num">${formatMoneyIndian(l.unitPricePaise)}</td>
          ${l.discountPaise ? `<td class="num">${formatMoneyIndian(l.discountPaise)}</td>` : '<td class="num">—</td>'}
          ${showGst ? `<td class="num">${escapeHtml(formatPercentPlain(l.taxRateBp))}%</td>` : ''}
          <td class="num">${formatMoneyIndian(taxable)}</td>
        </tr>`;
    })
    .join('');

  const totalsRows: string[] = [
    `<tr><td>Items total</td><td class="num">${formatMoneyIndian(invoice.totals.subtotalPaise)}</td></tr>`,
  ];
  if (invoice.totals.totalDiscountPaise > 0) {
    totalsRows.push(`<tr><td>Discount</td><td class="num">− ${formatMoneyIndian(invoice.totals.totalDiscountPaise)}</td></tr>`);
  }
  if (showGst) {
    totalsRows.push(`<tr><td>Taxable value</td><td class="num">${formatMoneyIndian(invoice.totals.taxableValuePaise)}</td></tr>`);
    if (isIgst) {
      totalsRows.push(`<tr><td>IGST</td><td class="num">${formatMoneyIndian(invoice.totals.igstPaise)}</td></tr>`);
    } else {
      if (invoice.totals.cgstPaise) totalsRows.push(`<tr><td>CGST</td><td class="num">${formatMoneyIndian(invoice.totals.cgstPaise)}</td></tr>`);
      if (invoice.totals.sgstPaise) totalsRows.push(`<tr><td>${stateTaxLabel}</td><td class="num">${formatMoneyIndian(invoice.totals.sgstPaise)}</td></tr>`);
    }
    if (invoice.totals.cessPaise) totalsRows.push(`<tr><td>Cess</td><td class="num">${formatMoneyIndian(invoice.totals.cessPaise)}</td></tr>`);
  }
  if (invoice.totals.roundOffPaise !== 0) {
    const sign = invoice.totals.roundOffPaise > 0 ? '+' : '−';
    totalsRows.push(`<tr><td>Rounded off</td><td class="num">${sign} ${formatMoneyIndian(Math.abs(invoice.totals.roundOffPaise))}</td></tr>`);
  }

  const bank = seller?.bank;
  const hasBank = Boolean(bank && (bank.accountNumber || bank.upiId));

  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(snap?.documentTitle ?? 'Draft')} ${escapeHtml(invoice.number ?? '')}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 10.5pt; color: #1a1a1a; margin: 0; line-height: 1.45;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .accent { color: ${accent}; }
  header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start;
           border-bottom: 2px solid ${accent}; padding-bottom: 10px; margin-bottom: 14px; }
  .logo { max-height: 64px; max-width: 180px; object-fit: contain; }
  .seller-name { font-size: 15pt; font-weight: 700; margin: 0 0 2px; }
  .muted { color: #555; font-size: 9.5pt; }
  .doc-title { font-size: 13pt; font-weight: 700; text-align: right; text-transform: uppercase; letter-spacing: 0.04em; }
  .doc-meta { text-align: right; font-size: 9.5pt; color: #444; margin-top: 4px; }
  .doc-meta strong { color: #1a1a1a; }
  .parties { display: flex; gap: 20px; margin-bottom: 14px; }
  .party { flex: 1; }
  .party h3 { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.06em; color: #666;
              margin: 0 0 4px; font-weight: 700; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  table.items thead th { background: ${accent}; color: #fff; font-size: 9pt; text-align: left;
                         padding: 7px 8px; font-weight: 600; }
  table.items tbody td { padding: 7px 8px; border-bottom: 1px solid #e4e4e4; vertical-align: top; }
  table.items tbody tr:nth-child(even) { background: #fafafa; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .desc { font-weight: 500; }
  .sub { font-size: 8.5pt; color: #666; }
  .foot { display: flex; gap: 20px; align-items: flex-start; }
  .foot-left { flex: 1.3; }
  .foot-right { flex: 1; }
  table.totals { width: 100%; border-collapse: collapse; }
  table.totals td { padding: 5px 8px; font-size: 10pt; }
  table.totals td.num { text-align: right; }
  table.totals tr.grand td { border-top: 2px solid #1a1a1a; font-size: 12pt; font-weight: 700; padding-top: 8px; }
  .words { margin-top: 8px; font-size: 9.5pt; color: #333; font-style: italic; }
  .box { border: 1px solid #ddd; border-radius: 6px; padding: 9px 11px; margin-bottom: 10px; }
  .box h3 { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.06em; color: #666;
            margin: 0 0 5px; font-weight: 700; }
  .box .line { font-size: 9.5pt; }
  .sign { margin-top: 18px; text-align: right; }
  .sign img { max-height: 52px; max-width: 150px; }
  .sign .rule { border-top: 1px solid #999; width: 170px; margin: 4px 0 0 auto; padding-top: 3px;
                font-size: 9pt; color: #555; }
  .qr { width: 104px; height: 104px; object-fit: contain; }
  .watermark {
    position: fixed; top: 42%; left: 50%; transform: translate(-50%, -50%) rotate(-28deg);
    font-size: 78pt; font-weight: 800; color: rgba(190, 40, 30, 0.13); letter-spacing: 0.08em;
    z-index: 0; pointer-events: none;
  }
  .content { position: relative; z-index: 1; }
  .note { margin-top: 10px; font-size: 9.5pt; color: #444; white-space: pre-wrap; }
  .legal { margin-top: 14px; padding-top: 8px; border-top: 1px solid #e4e4e4;
           font-size: 8pt; color: #777; }
  /* Repeat the header row when a long bill runs onto a second page. */
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
</style>
</head>
<body>
${isDraft ? '<div class="watermark">DRAFT</div>' : ''}
<div class="content">

  <header>
    <div>
      ${logo ? `<img class="logo" src="${logo}" alt="">` : ''}
      <p class="seller-name">${escapeHtml(seller?.legalName ?? 'Your business')}</p>
      ${seller?.tradeName ? `<div class="muted">${escapeHtml(seller.tradeName)}</div>` : ''}
      <div class="muted">
        ${[seller?.addressLine1, seller?.addressLine2, seller?.city, seller?.pincode].filter(Boolean).map(escapeHtml).join(', ')}
        ${seller?.stateCode ? `<br>${escapeHtml(stateName(seller.stateCode))}` : ''}
      </div>
      <div class="muted">
        ${seller?.gstin ? `GSTIN: <strong>${escapeHtml(seller.gstin)}</strong><br>` : ''}
        ${seller?.pan ? `PAN: ${escapeHtml(seller.pan)}<br>` : ''}
        ${seller?.phone ? `${escapeHtml(seller.phone)}` : ''}${seller?.email ? ` · ${escapeHtml(seller.email)}` : ''}
      </div>
    </div>
    <div>
      <div class="doc-title accent">${escapeHtml(snap?.documentTitle ?? 'Draft')}</div>
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
        ${customer.phone ? `<br>${escapeHtml(customer.phone)}` : ''}
      </div>
    </div>
    ${
      showGst && snap?.placeOfSupplyStateCode
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
        <th class="num">Discount</th>
        ${showGst ? '<th class="num">GST</th>' : ''}
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="foot">
    <div class="foot-left">
      ${
        hasBank
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
      ${upiQr ? `<img class="qr" src="${upiQr}" alt="UPI payment QR code">` : ''}
      ${invoice.notes ? `<div class="note">${escapeHtml(invoice.notes)}</div>` : ''}
    </div>

    <div class="foot-right">
      <table class="totals">
        ${totalsRows.join('')}
        <tr class="grand">
          <td>Total</td>
          <td class="num">${formatMoneyIndian(invoice.totals.grandTotalPaise, { withSymbol: true })}</td>
        </tr>
      </table>
      <div class="words">${escapeHtml(amountInWords(invoice.totals.grandTotalPaise))}</div>

      <div class="sign">
        ${signature ? `<img src="${signature}" alt="">` : ''}
        <div class="rule">For ${escapeHtml(seller?.legalName ?? '')}</div>
      </div>
    </div>
  </div>

  <div class="legal">
    ${
      upiQr
        ? 'The QR code above is a UPI payment code. It is not a government e-invoice QR code. '
        : ''
    }This document was prepared with EasyBills.
  </div>

</div>
</body>
</html>`;
}
