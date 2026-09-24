import { describe, expect, it } from 'vitest';

import { assessIssuance } from '@/lib/gst/scenarios';
import { computeTax, TaxEngineError } from '@/lib/gst/tax-engine';
import { checkGstin, gstinCheckDigit } from '@/lib/gst/gstin';
import { parseMoney, parsePercent, parseQuantity } from '@/lib/money';

const L = (id: string, description: string, qty: string, price: string, rate: string, extra = {}) => ({
  id,
  description,
  quantityMilli: parseQuantity(qty),
  unitPricePaise: parseMoney(price),
  taxRateBp: parsePercent(rate),
  ...extra,
});

/**
 * KNOWN CALCULATION FIXTURES
 *
 * The first fixture is the worked example from the product brief: two visits at
 * 800 plus parts of 450, which must subtotal 2,050 BEFORE any tax. No tax rate is
 * assumed for it -- the owner states one.
 */
describe('calculation fixtures', () => {
  const repairLines = [L('a', 'Repair visit', '2', '800', '0'), L('b', 'Spare parts', '1', '450', '0')];

  it('subtotals the brief’s example to 2,050 with no tax for an unregistered seller', () => {
    const r = computeTax({
      sellerStateCode: null,
      placeOfSupplyStateCode: null,
      chargesGst: false,
      roundToNearestRupee: true,
      lines: repairLines,
    });
    expect(r.subtotalPaise).toBe(205000);
    expect(r.totalTaxPaise).toBe(0);
    expect(r.grandTotalPaise).toBe(205000);
    expect(r.supplyType).toBe('no-gst');
  });

  it('splits an intra-state supply into equal CGST and SGST halves', () => {
    const r = computeTax({
      sellerStateCode: '27',
      placeOfSupplyStateCode: '27',
      chargesGst: true,
      roundToNearestRupee: true,
      lines: [L('a', 'Repair visit', '2', '800', '18'), L('b', 'Spare parts', '1', '450', '18')],
    });
    expect(r.supplyType).toBe('intra-state');
    expect(r.taxableValuePaise).toBe(205000);
    expect(r.cgstPaise).toBe(18450);
    expect(r.sgstPaise).toBe(18450);
    expect(r.igstPaise).toBe(0);
    expect(r.cgstPaise + r.sgstPaise).toBe(36900);
    expect(r.grandTotalPaise).toBe(241900);
  });

  it('charges IGST on an interstate supply and reaches the same total', () => {
    const r = computeTax({
      sellerStateCode: '27',
      placeOfSupplyStateCode: '29',
      chargesGst: true,
      roundToNearestRupee: true,
      lines: [L('a', 'Repair visit', '2', '800', '18'), L('b', 'Spare parts', '1', '450', '18')],
    });
    expect(r.supplyType).toBe('inter-state');
    expect(r.igstPaise).toBe(36900);
    expect(r.cgstPaise).toBe(0);
    expect(r.grandTotalPaise).toBe(241900);
  });

  it('uses UTGST for a union territory without a legislature, SGST for Delhi', () => {
    const chandigarh = computeTax({
      sellerStateCode: '04',
      placeOfSupplyStateCode: '04',
      chargesGst: true,
      roundToNearestRupee: false,
      lines: [L('a', 'Service', '1', '1000', '18')],
    });
    expect(chandigarh.stateTaxAuthority).toBe('UTGST');
    const delhi = computeTax({
      sellerStateCode: '07',
      placeOfSupplyStateCode: '07',
      chargesGst: true,
      roundToNearestRupee: false,
      lines: [L('a', 'Service', '1', '1000', '18')],
    });
    expect(delhi.stateTaxAuthority).toBe('SGST');
  });

  it('backs tax out of a tax-inclusive price', () => {
    const r = computeTax({
      sellerStateCode: '27',
      placeOfSupplyStateCode: '27',
      chargesGst: true,
      roundToNearestRupee: false,
      lines: [L('a', 'All-in price', '1', '1180', '18', { priceIncludesTax: true })],
    });
    expect(r.taxableValuePaise).toBe(100000);
    expect(r.totalTaxPaise).toBe(18000);
    expect(r.totalBeforeRoundingPaise).toBe(118000);
  });

  it('applies a line discount before tax', () => {
    const r = computeTax({
      sellerStateCode: '27',
      placeOfSupplyStateCode: '27',
      chargesGst: true,
      roundToNearestRupee: false,
      lines: [L('a', 'Service', '1', '1000', '18', { discountPaise: parseMoney('100') })],
    });
    expect(r.taxableValuePaise).toBe(90000);
    expect(r.totalTaxPaise).toBe(16200);
  });

  it('carries the rupee round-off as a visible, reconciling figure', () => {
    const r = computeTax({
      sellerStateCode: '27',
      placeOfSupplyStateCode: '27',
      chargesGst: true,
      roundToNearestRupee: true,
      lines: [L('a', 'Odd', '1', '999.49', '18')],
    });
    expect(r.totalBeforeRoundingPaise + r.roundOffPaise).toBe(r.grandTotalPaise);
    expect(r.grandTotalPaise % 100).toBe(0);
  });

  it('keeps cess as a head of its own', () => {
    const r = computeTax({
      sellerStateCode: '27',
      placeOfSupplyStateCode: '29',
      chargesGst: true,
      roundToNearestRupee: false,
      lines: [L('a', 'Cess item', '1', '1000', '28', { cessRateBp: parsePercent('12') })],
    });
    expect(r.igstPaise).toBe(28000);
    expect(r.cessPaise).toBe(12000);
    expect(r.totalTaxPaise).toBe(40000);
  });

  it('groups by rate, which is what return tables are built from', () => {
    const r = computeTax({
      sellerStateCode: '27',
      placeOfSupplyStateCode: '27',
      chargesGst: true,
      roundToNearestRupee: false,
      lines: [
        L('a', 'Five', '1', '1000', '5'),
        L('b', 'Eighteen', '1', '1000', '18'),
        L('c', 'Five again', '2', '500', '5'),
      ],
    });
    expect(r.rateSummary).toHaveLength(2);
    expect(r.rateSummary[0]).toMatchObject({ taxRateBp: 500, taxableValuePaise: 200000 });
    expect(r.rateSummary[1]).toMatchObject({ taxRateBp: 1800, taxableValuePaise: 100000 });
  });

  it('reports rather than hides an uneven split on an odd rate', () => {
    const r = computeTax({
      sellerStateCode: '27',
      placeOfSupplyStateCode: '27',
      chargesGst: true,
      roundToNearestRupee: false,
      // 0.1% on 333.33 gives 0.333 paise per half -- the halves can differ by one.
      lines: [L('a', 'Odd rate', '1', '333.33', '0.1')],
    });
    expect(r.cgstPaise + r.sgstPaise).toBe(r.totalTaxPaise);
  });

  it('refuses invalid input instead of producing a wrong number', () => {
    expect(() =>
      computeTax({
        sellerStateCode: '27',
        placeOfSupplyStateCode: '27',
        chargesGst: true,
        roundToNearestRupee: false,
        lines: [L('a', 'Bad', '1', '100', '18', { discountPaise: parseMoney('500') })],
      }),
    ).toThrow(TaxEngineError);

    expect(() =>
      computeTax({
        sellerStateCode: '27',
        placeOfSupplyStateCode: null,
        chargesGst: true,
        roundToNearestRupee: false,
        lines: [L('a', 'No place of supply', '1', '100', '18')],
      }),
    ).toThrow(TaxEngineError);
  });
});

describe('GSTIN validation', () => {
  it('accepts a well-formed GSTIN and derives its state', () => {
    const r = checkGstin('27AAPFU0939F1ZV');
    expect(r.ok).toBe(true);
    expect(r.stateCode).toBe('27');
    expect(r.stateName).toBe('Maharashtra');
    expect(r.pan).toBe('AAPFU0939F');
  });

  it('catches a single-character typo through the check digit', () => {
    expect(checkGstin('27AAPFU0939F1ZX').problem).toBe('checksum');
  });

  it('rejects an unknown state code and a wrong length', () => {
    expect(checkGstin('99AAPFU0939F1ZV').problem).toBe('unknown-state');
    expect(checkGstin('27AAPFU0939F1Z').problem).toBe('length');
  });

  it('computes check digits consistently', () => {
    expect(gstinCheckDigit('27AAPFU0939F1Z')).toBe('V');
  });
});

describe('issuance assessment', () => {
  const base = {
    registrationType: 'regular' as const,
    sellerStateCode: '27',
    sellerGstin: '27AAPFU0939F1ZV',
    placeOfSupplyStateCode: '27',
    supplyFlags: [] as never[],
    declaredAggregateTurnoverPaise: null,
    eInvoicingSelfDeclaredNotApplicable: true,
    issueDate: '2026-09-24',
  };

  it('allows an ordinary domestic supply by a regular registrant', () => {
    const a = assessIssuance(base);
    expect(a.canIssue).toBe(true);
    expect(a.documentTitle).toBe('Tax Invoice');
    expect(a.chargesGst).toBe(true);
  });

  it('allows an unregistered business to bill without GST', () => {
    const a = assessIssuance({ ...base, registrationType: 'not-registered', sellerGstin: null });
    expect(a.canIssue).toBe(true);
    expect(a.documentTitle).toBe('Invoice');
    expect(a.chargesGst).toBe(false);
  });

  it('blocks until e-invoicing applicability has been settled', () => {
    const a = assessIssuance({ ...base, eInvoicingSelfDeclaredNotApplicable: false });
    expect(a.canIssue).toBe(false);
    expect(a.blockers.map((b) => b.code)).toContain('e-invoicing-unscreened');
  });

  it.each([
    ['composition', 'composition-not-supported'],
    ['not-sure', 'gst-status-unconfirmed'],
  ] as const)('blocks a %s business with a plain explanation', (registrationType, code) => {
    const a = assessIssuance({ ...base, registrationType });
    expect(a.canIssue).toBe(false);
    expect(a.blockers.map((b) => b.code)).toContain(code);
    // The message must be plain language the owner can act on.
    expect(a.blockers[0]!.whatYouCanDo.length).toBeGreaterThan(10);
  });

  it.each(['export', 'sez', 'reverse-charge', 'advance-receipt', 'exempt-or-nil-rated'] as const)(
    'blocks an unsupported supply type: %s',
    (flag) => {
      const a = assessIssuance({ ...base, supplyFlags: [flag] as never });
      expect(a.canIssue).toBe(false);
      expect(a.blockers.some((b) => b.code === `unsupported-supply:${flag}`)).toBe(true);
    },
  );

  it('blocks a regular registrant with no GSTIN or no confirmed place of supply', () => {
    expect(assessIssuance({ ...base, sellerGstin: null }).blockers.map((b) => b.code)).toContain('missing-gstin');
    expect(assessIssuance({ ...base, placeOfSupplyStateCode: null }).blockers.map((b) => b.code)).toContain(
      'missing-place-of-supply',
    );
  });
});
