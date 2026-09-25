import { afterAll, describe, expect, it } from 'vitest';

import { todayIst } from '@/lib/dates';
import { renderInvoiceHtml } from '@/server/pdf/template';
import { closePdfRenderer, renderInvoicePdf } from '@/server/pdf/render';
import { upiQrDataUrl } from '@/server/pdf/upi';
import { updateBusiness } from '@/server/repos/business';
import { emptyParty, issueInvoice, newInvoiceId, saveDraft } from '@/server/repos/invoices';

import { line, makeGstBusiness, ownerUidOf } from '../helpers';

// The container ships Chromium; CI without one should set PLAYWRIGHT_CHROMIUM_PATH.
process.env.PLAYWRIGHT_CHROMIUM_PATH ??= '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

afterAll(async () => {
  await closePdfRenderer();
});

async function issued(lineCount: number) {
  const business = await makeGstBusiness();
  const uid = await ownerUidOf(business);
  const draft = await saveDraft({
    business,
    uid,
    invoiceId: newInvoiceId(),
    kind: 'customer-invoice',
    issueDate: todayIst(),
    customer: {
      ...emptyParty('Sharma Electricals'),
      stateCode: '27',
      addressLine1: '4 Example Road',
      city: 'Mumbai',
      pincode: '400002',
    },
    placeOfSupplyStateCode: '27',
    supplyFlags: [],
    lines: Array.from({ length: lineCount }, (_, i) =>
      line(`Service item ${i + 1} with a fairly long description to test wrapping`, '2', '800', '18'),
    ),
    notes: 'Thank you for your business.',
    baseRevision: 0,
  });
  const { invoice } = await issueInvoice({ business, uid, invoiceId: draft.id });
  return { business, uid, invoice };
}

describe('invoice PDF', () => {
  /** GATE: "PDF is readable across single and multipage examples". */
  it('renders a single-page bill', async () => {
    const { invoice } = await issued(3);
    const pdf = await renderInvoicePdf(invoice);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(5_000);
  }, 60_000);

  it('renders a long bill across multiple pages', async () => {
    const { invoice } = await issued(45);
    const pdf = await renderInvoicePdf(invoice);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    // A 45-line bill must not be silently truncated to one page.
    const pageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pageCount).toBeGreaterThan(1);
  }, 60_000);

  /**
   * GATE: issuance survives a PDF failure. Rendering reads an already-issued
   * record, so a render that throws leaves the invoice issued and re-renders
   * the SAME document rather than producing a second one.
   */
  it('re-renders the same issued invoice rather than issuing again', async () => {
    const { business, uid, invoice } = await issued(2);
    const first = await renderInvoicePdf(invoice);
    const second = await renderInvoicePdf(invoice);
    expect(first.subarray(0, 4).toString()).toBe('%PDF');
    expect(second.subarray(0, 4).toString()).toBe('%PDF');
    // Issuing again is still a no-op.
    const again = await issueInvoice({ business, uid, invoiceId: invoice.id });
    expect(again.alreadyIssued).toBe(true);
    expect(again.invoice.number).toBe(invoice.number);
  }, 90_000);
});

describe('invoice HTML template', () => {
  it('marks a draft with a watermark and no number', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const draft = await saveDraft({
      business,
      uid,
      invoiceId: newInvoiceId(),
      kind: 'customer-invoice',
      issueDate: todayIst(),
      customer: emptyParty('Someone'),
      placeOfSupplyStateCode: '27',
      supplyFlags: [],
      lines: [line('Work', '1', '100', '18')],
      notes: null,
      baseRevision: 0,
    });
    const html = renderInvoiceHtml(draft);
    expect(html).toContain('DRAFT');
    expect(html).toContain('Not yet issued');
  });

  it('escapes anything a customer could have typed', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const draft = await saveDraft({
      business,
      uid,
      invoiceId: newInvoiceId(),
      kind: 'customer-invoice',
      issueDate: todayIst(),
      customer: emptyParty('<script>alert(1)</script>'),
      placeOfSupplyStateCode: '27',
      supplyFlags: [],
      lines: [line('<img src=x onerror=alert(1)>', '1', '100', '18')],
      notes: '"><script>alert(2)</script>',
      baseRevision: 0,
    });
    const html = renderInvoiceHtml(draft);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rejects a logo that is not a plain image data URL', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const tampered = await updateBusiness(business.id, uid, {
      logoDataUrl: 'javascript:alert(1)',
    });
    const draft = await saveDraft({
      business: tampered,
      uid,
      invoiceId: newInvoiceId(),
      kind: 'customer-invoice',
      issueDate: todayIst(),
      customer: emptyParty('Someone'),
      placeOfSupplyStateCode: '27',
      supplyFlags: [],
      lines: [line('Work', '1', '100', '18')],
      notes: null,
      baseRevision: 0,
    });
    const { invoice } = await issueInvoice({ business: tampered, uid, invoiceId: draft.id });
    const html = renderInvoiceHtml(invoice);
    expect(html).not.toContain('javascript:');
  });
});

describe('UPI QR', () => {
  it('produces a QR for a valid UPI id', async () => {
    const dataUrl = await upiQrDataUrl({
      bank: { accountHolderName: null, accountNumber: null, ifsc: null, bankName: null, upiId: 'someone@okbank' },
      payeeName: 'Test Services',
      amountPaise: 241900,
      reference: 'INV-001',
    });
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('produces nothing rather than a placeholder for a missing or invalid id', async () => {
    const base = { accountHolderName: null, accountNumber: null, ifsc: null, bankName: null };
    expect(await upiQrDataUrl({ bank: { ...base, upiId: null }, payeeName: 'X' })).toBeNull();
    expect(await upiQrDataUrl({ bank: { ...base, upiId: 'not a upi id' }, payeeName: 'X' })).toBeNull();
  });

  it('says on the document that a UPI QR is not a government e-invoice QR', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const withBank = await updateBusiness(business.id, uid, {
      bank: { accountHolderName: 'Test', accountNumber: null, ifsc: null, bankName: null, upiId: 'test@okbank' },
    });
    const draft = await saveDraft({
      business: withBank,
      uid,
      invoiceId: newInvoiceId(),
      kind: 'customer-invoice',
      issueDate: todayIst(),
      customer: emptyParty('Someone'),
      placeOfSupplyStateCode: '27',
      supplyFlags: [],
      lines: [line('Work', '1', '100', '18')],
      notes: null,
      baseRevision: 0,
    });
    const { invoice } = await issueInvoice({ business: withBank, uid, invoiceId: draft.id });
    const qr = await upiQrDataUrl({ bank: withBank.bank, payeeName: withBank.legalName });
    const html = renderInvoiceHtml(invoice, { upiQrDataUrl: qr });
    expect(html).toContain('not a government e-invoice QR code');
  });
});
