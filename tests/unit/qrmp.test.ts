import { describe, expect, it } from 'vitest';

import { excludeIffFurnished, nextFilingPeriod, obligationsFor, qrmpPlan } from '@/lib/gst-returns/qrmp';

describe('QRMP quarters', () => {
  it('groups months into financial-year quarters', () => {
    expect(qrmpPlan('2026-09', false).months).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(qrmpPlan('2026-07', false).quarterPeriod).toBe('2026-09');
    // January to March belongs to the PREVIOUS financial year's last quarter.
    expect(qrmpPlan('2026-02', false).months).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('offers IFF only in the first two months, and only when used', () => {
    expect(qrmpPlan('2026-09', true).iffMonths).toEqual(['2026-07', '2026-08']);
    expect(qrmpPlan('2026-09', false).iffMonths).toEqual([]);
  });

  it('keeps a monthly payment obligation in the first two months', () => {
    expect(qrmpPlan('2026-09', false).monthlyPaymentMonths).toEqual(['2026-07', '2026-08']);
  });
});

describe('what is owed in a month', () => {
  it('gives a monthly filer both returns every month', () => {
    const o = obligationsFor('2026-09', 'monthly', false);
    expect(o.forms.map((f) => f.form)).toEqual(['GSTR-1', 'GSTR-3B']);
    expect(o.paymentOnlyMonth).toBe(false);
  });

  it('gives a quarterly filer both returns only at the quarter end', () => {
    const o = obligationsFor('2026-09', 'quarterly-qrmp', false);
    expect(o.forms.map((f) => f.form)).toEqual(['GSTR-1', 'GSTR-3B']);
    // The quarterly return covers all three months, not just September.
    expect(o.forms[0]!.coversPeriods).toEqual(['2026-07', '2026-08', '2026-09']);
  });

  /**
   * The distinction that matters for QRMP: months 1 and 2 file nothing but are
   * still payment months. Treating them as "nothing due" would be wrong.
   */
  it('marks the first two months of a quarter as payment-only', () => {
    const july = obligationsFor('2026-07', 'quarterly-qrmp', false);
    expect(july.forms).toHaveLength(0);
    expect(july.paymentOnlyMonth).toBe(true);
  });

  it('adds IFF to those months when the taxpayer uses it', () => {
    const july = obligationsFor('2026-07', 'quarterly-qrmp', true);
    expect(july.forms.map((f) => f.form)).toEqual(['IFF']);
    expect(july.paymentOnlyMonth).toBe(true);
  });

  it('advances by one month or one quarter as appropriate', () => {
    expect(nextFilingPeriod('2026-09', 'monthly')).toBe('2026-10');
    expect(nextFilingPeriod('2026-09', 'quarterly-qrmp')).toBe('2026-12');
  });
});

describe('IFF de-duplication', () => {
  const docs = [
    { documentNumber: 'INV-001', documentDate: '2026-07-10' },
    { documentNumber: 'INV-002', documentDate: '2026-07-22' },
    { documentNumber: 'INV-003', documentDate: '2026-08-05' },
    { documentNumber: 'INV-004', documentDate: '2026-09-15' },
  ];

  /**
   * GATE: "IFF records do not duplicate quarterly sales."
   *
   * Anything already furnished through IFF in months 1 and 2 must be left out
   * of the quarterly return, or the same sale is reported twice.
   */
  it('excludes documents already furnished through IFF', () => {
    const { included, excluded } = excludeIffFurnished(docs, [
      { period: '2026-07', documentNumbers: ['INV-001', 'INV-002'] },
      { period: '2026-08', documentNumbers: ['INV-003'] },
    ]);
    expect(excluded.map((d) => d.documentNumber)).toEqual(['INV-001', 'INV-002', 'INV-003']);
    // Only the third month's sale remains for the quarterly return.
    expect(included.map((d) => d.documentNumber)).toEqual(['INV-004']);
  });

  it('keeps everything when IFF was not used', () => {
    const { included, excluded } = excludeIffFurnished(docs, []);
    expect(included).toHaveLength(4);
    expect(excluded).toHaveLength(0);
  });

  it('matches within the month it was furnished, not across months', () => {
    // The same number furnished for a DIFFERENT month must not exclude this one.
    const { included } = excludeIffFurnished(docs, [{ period: '2026-08', documentNumbers: ['INV-001'] }]);
    expect(included.map((d) => d.documentNumber)).toContain('INV-001');
  });

  it('does not exclude a third-month document even if listed by mistake', () => {
    // September is never an IFF month, so a stray entry cannot drop a sale from
    // the quarterly return... unless the period genuinely matches.
    const { included } = excludeIffFurnished(docs, [{ period: '2026-07', documentNumbers: ['INV-004'] }]);
    expect(included.map((d) => d.documentNumber)).toContain('INV-004');
  });

  it('totals correctly across IFF and the quarterly return, counting each sale once', () => {
    const withAmounts = [
      { documentNumber: 'INV-001', documentDate: '2026-07-10', amount: 1000 },
      { documentNumber: 'INV-002', documentDate: '2026-08-05', amount: 2000 },
      { documentNumber: 'INV-003', documentDate: '2026-09-15', amount: 3000 },
    ];
    const furnished = [
      { period: '2026-07', documentNumbers: ['INV-001'] },
      { period: '2026-08', documentNumbers: ['INV-002'] },
    ];
    const { included, excluded } = excludeIffFurnished(withAmounts, furnished);

    const iffTotal = excluded.reduce((n, d) => n + d.amount, 0);
    const quarterlyTotal = included.reduce((n, d) => n + d.amount, 0);

    expect(iffTotal).toBe(3000);
    expect(quarterlyTotal).toBe(3000);
    // The sum across both is the true turnover -- 6,000, not 9,000.
    expect(iffTotal + quarterlyTotal).toBe(6000);
  });
});
