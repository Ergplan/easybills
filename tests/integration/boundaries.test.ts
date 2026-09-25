import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import { todayIst } from '@/lib/dates';
import { MoneyError, parseMoney, parseQuantity } from '@/lib/money';
import { saveDraftInput } from '@/lib/domain/validation';
import { computeTax, TaxEngineError } from '@/lib/gst/tax-engine';
import { parseSupplierBillCsv, parseCsv } from '@/lib/gst-returns/import';
import { emptyParty, getInvoice, issueInvoice, newInvoiceId, saveDraft } from '@/server/repos/invoices';
import { renderInvoiceHtml } from '@/server/pdf/template';

import { line, makeGstBusiness, ownerUidOf } from '../helpers';

describe('amounts at the edges', () => {
  it('refuses an amount beyond exact integer arithmetic', () => {
    // Past 2^53 paise, addition stops being exact. Better to refuse than to be
    // quietly wrong about somebody's money.
    expect(() => parseMoney('99999999999999999999')).toThrow(MoneyError);
  });

  it('handles a genuinely large but legitimate invoice', () => {
    const r = computeTax({
      sellerStateCode: '27', placeOfSupplyStateCode: '27', chargesGst: true, roundToNearestRupee: true,
      lines: [{ id: 'a', description: 'Big job', quantityMilli: parseQuantity('1'), unitPricePaise: parseMoney('99999999.99'), taxRateBp: 1800 }],
    });
    expect(r.taxableValuePaise).toBe(9_999_999_999);
    // 9% of 9,999,999,999 is 899,999,999.91 per head, rounded half-up.
    expect(r.cgstPaise).toBe(900_000_000);
    expect(r.sgstPaise).toBe(900_000_000);
    expect(r.grandTotalPaise % 100).toBe(0);
    // Still exact: nothing has drifted into float territory.
    expect(Number.isSafeInteger(r.grandTotalPaise)).toBe(true);
  });

  it('refuses a negative price or quantity rather than inverting the bill', () => {
    expect(() =>
      computeTax({
        sellerStateCode: '27', placeOfSupplyStateCode: '27', chargesGst: true, roundToNearestRupee: false,
        lines: [{ id: 'a', description: 'Negative', quantityMilli: 1000, unitPricePaise: -100, taxRateBp: 1800 }],
      }),
    ).toThrow(TaxEngineError);
    expect(() =>
      computeTax({
        sellerStateCode: '27', placeOfSupplyStateCode: '27', chargesGst: true, roundToNearestRupee: false,
        lines: [{ id: 'a', description: 'Negative qty', quantityMilli: -1000, unitPricePaise: 100, taxRateBp: 1800 }],
      }),
    ).toThrow(TaxEngineError);
  });

  it('accepts a zero-value line without dividing by anything', () => {
    const r = computeTax({
      sellerStateCode: '27', placeOfSupplyStateCode: '27', chargesGst: true, roundToNearestRupee: true,
      lines: [{ id: 'a', description: 'Free sample', quantityMilli: 1000, unitPricePaise: 0, taxRateBp: 1800 }],
    });
    expect(r.grandTotalPaise).toBe(0);
    expect(r.totalTaxPaise).toBe(0);
  });

  it('rounds a long tail of paise consistently across many lines', () => {
    // 100 lines of 0.005 each. Each rounds independently; the total must equal
    // the sum of the rounded lines, never a re-rounded total.
    const lines = Array.from({ length: 100 }, (_, i) => ({
      id: `l${i}`, description: `Line ${i}`, quantityMilli: 1000, unitPricePaise: 1, taxRateBp: 500,
    }));
    const r = computeTax({
      sellerStateCode: '27', placeOfSupplyStateCode: '27', chargesGst: true, roundToNearestRupee: false, lines,
    });
    const sumOfLines = r.lines.reduce((n, l) => n + l.lineTotalPaise, 0);
    expect(r.totalBeforeRoundingPaise).toBe(sumOfLines);
  });

  it('rejects a tax rate outside any plausible range', () => {
    expect(() =>
      computeTax({
        sellerStateCode: '27', placeOfSupplyStateCode: '27', chargesGst: true, roundToNearestRupee: false,
        lines: [{ id: 'a', description: 'Absurd', quantityMilli: 1000, unitPricePaise: 1000, taxRateBp: 999_999 }],
      }),
    ).toThrow(TaxEngineError);
  });
});

describe('hostile text', () => {
  it('refuses input that is not a number instead of coercing it', () => {
    for (const bad of ['1e9', 'Infinity', 'NaN', '0x10', '1,2,3.4.5', '--5', '5-', '+-1']) {
      expect(() => parseMoney(bad), `should reject ${bad}`).toThrow(MoneyError);
    }
  });

  /**
   * Asserting that the string "onerror=" is absent would be the wrong test:
   * escaped text may legitimately read that way. What matters is whether a
   * BROWSER builds a live script element or event handler out of it, so the
   * document is actually rendered and inspected.
   */
  it('renders hostile text inertly in a real browser', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const nasty = '"><script>alert(1)</script><img src=x onerror=alert(2)>';
    const draft = await saveDraft({
      business, uid, invoiceId: newInvoiceId(), kind: 'customer-invoice', issueDate: todayIst(),
      customer: { ...emptyParty(nasty), addressLine1: nasty, stateCode: '27' },
      placeOfSupplyStateCode: '27', supplyFlags: [],
      lines: [line(nasty, '1', '100', '18')], notes: nasty, baseRevision: 0,
    });
    const { invoice } = await issueInvoice({ business, uid, invoiceId: draft.id });
    const html = renderInvoiceHtml(invoice);

    const browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
      args: ['--no-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const live = await page.evaluate(() => ({
        scripts: document.querySelectorAll('script').length,
        handlers: document.querySelectorAll('[onerror],[onload],[onclick]').length,
        injected: document.querySelectorAll('img[src="x"]').length,
        // The payload survives as visible TEXT, which is what it should be.
        shownAsText: document.body.innerText.includes('<script>'),
      }));
      expect(live.scripts).toBe(0);
      expect(live.handlers).toBe(0);
      expect(live.injected).toBe(0);
      expect(live.shownAsText).toBe(true);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it('carries non-Latin and right-to-left names through to the document', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const names = ['मीना शाह', 'மீனா ஷா', 'مِينَا', '孟娜', 'Ω≈ç√∫˜µ'];
    for (const name of names) {
      const draft = await saveDraft({
        business, uid, invoiceId: newInvoiceId(), kind: 'customer-invoice', issueDate: todayIst(),
        customer: { ...emptyParty(name), stateCode: '27' },
        placeOfSupplyStateCode: '27', supplyFlags: [],
        lines: [line(name, '1', '100', '18')], notes: null, baseRevision: 0,
      });
      const { invoice } = await issueInvoice({ business, uid, invoiceId: draft.id });
      expect(renderInvoiceHtml(invoice)).toContain(name);
    }
  });

  it('caps a very long description rather than storing it unbounded', () => {
    const result = saveDraftInput.safeParse({
      invoiceId: 'x', kind: 'quick-bill', issueDate: todayIst(),
      customer: { name: 'A', phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null, stateCode: null, gstin: null, pan: null, customerId: null },
      placeOfSupplyStateCode: null, supplyFlags: [],
      lines: [{ id: 'l', description: 'x'.repeat(5000), quantityMilli: '1', unitPricePaise: '1', discountPaise: '0', taxRateBp: '0', cessRateBp: '0', priceIncludesTax: false, unit: null, hsnCode: null, savedItemId: null }],
      notes: null, baseRevision: 0,
    });
    expect(result.success).toBe(false);
  });

  it('refuses more lines than a bill could plausibly have', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      id: `l${i}`, description: 'x', quantityMilli: '1', unitPricePaise: '1', discountPaise: '0',
      taxRateBp: '0', cessRateBp: '0', priceIncludesTax: false, unit: null, hsnCode: null, savedItemId: null,
    }));
    const result = saveDraftInput.safeParse({
      invoiceId: 'x', kind: 'quick-bill', issueDate: todayIst(),
      customer: { name: 'A', phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null, stateCode: null, gstin: null, pan: null, customerId: null },
      placeOfSupplyStateCode: null, supplyFlags: [], lines: many, notes: null, baseRevision: 0,
    });
    expect(result.success).toBe(false);
  });

  // An unanswered rate select and a deliberate nil-rated 0% both price as zero,
  // so the difference has to be captured before percentString flattens it.
  it.each([
    ['', false],
    [null, false],
    [undefined, false],
    ['0', true],
    ['18', true],
    [0, true],
  ])('reads a rate of %o as chosen=%s', (raw, chosen) => {
    const result = saveDraftInput.safeParse({
      invoiceId: 'x', kind: 'quick-bill', issueDate: todayIst(),
      customer: { name: 'A', phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null, stateCode: null, gstin: null, pan: null, customerId: null },
      placeOfSupplyStateCode: null, supplyFlags: [],
      lines: [{ id: 'l', description: 'Item', quantityMilli: '1', unitPricePaise: '100', discountPaise: '0', taxRateBp: raw, cessRateBp: '0', priceIncludesTax: false, unit: null, hsnCode: null, savedItemId: null }],
      notes: null, baseRevision: 0,
    });
    expect(result.success).toBe(true);
    expect(result.data!.lines[0]!.taxRateChosen).toBe(chosen);
    expect(result.data!.lines[0]!.taxRateBp).toBe(raw === '18' ? 1800 : 0);
  });

  // The flag is derived from the rate field the client sent, not accepted as a
  // separate claim, so a client cannot assert a rate was chosen when it was not.
  it('ignores a taxRateChosen the client tries to assert for itself', () => {
    const result = saveDraftInput.safeParse({
      invoiceId: 'x', kind: 'quick-bill', issueDate: todayIst(),
      customer: { name: 'A', phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null, stateCode: null, gstin: null, pan: null, customerId: null },
      placeOfSupplyStateCode: null, supplyFlags: [],
      lines: [{ id: 'l', description: 'Item', quantityMilli: '1', unitPricePaise: '100', discountPaise: '0', taxRateBp: '', taxRateChosen: true, cessRateBp: '0', priceIncludesTax: false, unit: null, hsnCode: null, savedItemId: null }],
      notes: null, baseRevision: 0,
    });
    expect(result.success).toBe(true);
    expect(result.data!.lines[0]!.taxRateChosen).toBe(false);
  });

  it('rejects a malformed date rather than guessing one', () => {
    for (const bad of ['2026-13-01', '2026-02-30', 'yesterday', '01/01/2026', '2026-2-3', '']) {
      const result = saveDraftInput.safeParse({
        invoiceId: 'x', kind: 'quick-bill', issueDate: bad,
        customer: { name: 'A', phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null, stateCode: null, gstin: null, pan: null, customerId: null },
        placeOfSupplyStateCode: null, supplyFlags: [], lines: [], notes: null, baseRevision: 0,
      });
      expect(result.success, `should reject ${bad}`).toBe(false);
    }
  });
});

describe('malformed imports', () => {
  it('reports bad rows instead of importing silence', () => {
    const csv = [
      'supplier_gstin,supplier_name,document_number,document_date,taxable_value,cgst,sgst,igst,cess',
      'NOTAGSTIN,Bad Supplier,B/1,2026-09-01,100,9,9,0,0',
      '27AAPFU0939F1ZV,Good Supplier,G/1,2026-09-02,100,9,9,0,0',
      '27AAPFU0939F1ZV,No Date,N/1,not-a-date,100,9,9,0,0',
      '27AAPFU0939F1ZV,No Number,,2026-09-03,100,9,9,0,0',
    ].join('\n');
    const rows = parseSupplierBillCsv(csv);
    expect(rows).toHaveLength(4);
    const good = rows.filter((r) => r.value);
    const bad = rows.filter((r) => !r.value);
    expect(good).toHaveLength(1);
    expect(bad).toHaveLength(3);
    // Every rejection names the row and says what was wrong.
    for (const b of bad) {
      expect(b.rowNumber).toBeGreaterThan(1);
      expect(b.error).toBeTruthy();
    }
  });

  it('survives quoted fields, embedded commas and stray newlines', () => {
    const rows = parseCsv('a,b\n"one, with comma","line\nbreak"\n\n,\n');
    expect(rows[1]![0]).toBe('one, with comma');
    expect(rows[1]![1]).toBe('line\nbreak');
  });

  it('does not choke on an empty or header-only file', () => {
    expect(parseSupplierBillCsv('')).toHaveLength(0);
    expect(parseSupplierBillCsv('supplier_name,document_number')).toHaveLength(0);
  });

  it('treats a file with the wrong columns as unreadable rows, not as data', () => {
    const rows = parseSupplierBillCsv('foo,bar\n1,2\n3,4');
    expect(rows.every((r) => r.value === null)).toBe(true);
  });
});

describe('a bill with very many items', () => {
  it('prices and renders 200 lines without drift', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const lines = Array.from({ length: 200 }, (_, i) => line(`Item ${i + 1}`, '1', '99.99', '18'));

    const draft = await saveDraft({
      business, uid, invoiceId: newInvoiceId(), kind: 'customer-invoice', issueDate: todayIst(),
      customer: { ...emptyParty('Bulk Buyer'), stateCode: '27' },
      placeOfSupplyStateCode: '27', supplyFlags: [], lines, notes: null, baseRevision: 0,
    });
    const { invoice } = await issueInvoice({ business, uid, invoiceId: draft.id });

    expect(invoice.lines).toHaveLength(200);
    expect(invoice.totals.taxableValuePaise).toBe(200 * 9999);
    // The stored total is the sum of its parts, to the paise.
    const stored = await getInvoice(business.id, invoice.id);
    expect(stored!.totals.taxableValuePaise + stored!.totals.totalTaxPaise + stored!.totals.roundOffPaise)
      .toBe(stored!.totals.grandTotalPaise);
    expect(renderInvoiceHtml(stored!)).toContain('Item 200');
  }, 30_000);
});
