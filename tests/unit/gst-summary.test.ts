import { describe, expect, it } from 'vitest';

import { quarterBounds, quarterCsv, summariseQuarter } from '@/lib/domain/gst-summary';
import type { InvoiceRecord } from '@/lib/domain/types';

function bill(id: string, issueDate: string, taxable: number, rateBp: number, opts: { gstin?: string | null; inter?: boolean } = {}): InvoiceRecord {
  const tax = Math.round((taxable * rateBp) / 10000);
  const half = Math.round(tax / 2);
  return {
    id, kind: 'customer-invoice', status: 'issued', number: `INV-${id}`, numberSequence: Number(id), financialYear: '2026-27',
    issueDate, dueDate: null, paymentTermsDays: null, billingPeriod: null,
    customer: { customerId: `c${id}`, name: `Customer ${id}`, phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null, stateCode: null, gstin: opts.gstin ?? null, pan: null },
    placeOfSupplyStateCode: '27', supplyFlags: [],
    lines: [{ id: 'l', description: 'Work', quantityMilli: 1000, unitPricePaise: taxable, discountPaise: 0, taxRateBp: rateBp, taxRateChosen: true, cessRateBp: 0, priceIncludesTax: false, unit: null, hsnCode: null, savedItemId: null }],
    notes: null,
    totals: { subtotalPaise: taxable, totalDiscountPaise: 0, taxableValuePaise: taxable, cgstPaise: opts.inter ? 0 : half, sgstPaise: opts.inter ? 0 : tax - half, igstPaise: opts.inter ? tax : 0, cessPaise: 0, totalTaxPaise: tax, totalBeforeRoundingPaise: taxable + tax, roundOffPaise: 0, grandTotalPaise: taxable + tax },
    paymentStatus: 'unpaid', amountPaidPaise: 0, creditAppliedPaise: 0, debitAppliedPaise: 0, settlementDeductionPaise: 0, balancePaise: taxable + tax,
    issued: { issuedAt: '', issuedByUid: 'u', documentKind: 'tax-invoice', documentTitle: 'Tax Invoice', seller: {} as never, customer: { customerId: `c${id}`, name: `Customer ${id}`, phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null, stateCode: null, gstin: opts.gstin ?? null, pan: null }, rulePackVersion: '1', supplyType: opts.inter ? 'inter-state' : 'intra-state', placeOfSupplyStateCode: '27' },
    cancelledAt: null, cancelledReason: null, scheduleId: null, occurrenceKey: null, duplicatedFromInvoiceId: null,
    revision: 1, createdAt: '', updatedAt: '', createdByUid: 'u',
  } as InvoiceRecord;
}

describe('the quarter', () => {
  it('follows the financial year', () => {
    expect(quarterBounds('2026-09')).toMatchObject({ label: 'Jul-Sep 2026-27', from: '2026-07-01', to: '2026-09-30' });
    expect(quarterBounds('2027-02')).toMatchObject({ label: 'Jan-Mar 2026-27', from: '2027-01-01', to: '2027-03-31' });
  });
});

describe('GST ka hisaab', () => {
  const issued = [
    bill('1', '2026-07-10', 5000000, 1800, { gstin: '27AAPFU0939F1ZV' }),
    bill('2', '2026-08-12', 1400000, 1200),
    bill('3', '2026-09-20', 4840000, 1800, { gstin: '27AAPFU0939F1ZV' }),
    bill('4', '2026-09-22', 1000000, 1800, { gstin: '29AABCG1234H1Z3', inter: true }),
    bill('5', '2026-06-30', 9999900, 1800), // last quarter
  ];

  it('counts the bills, the sales and the GST', () => {
    const q = summariseQuarter(issued, '2026-08');
    expect(q.bills).toBe(4);
    expect(q.salesPaise).toBe(5000000 + 1400000 + 4840000 + 1000000);
    expect(q.taxPaise).toBe(900000 + 168000 + 871200 + 180000);
  });

  it('splits by rate, CGST and SGST for intra-state and IGST across a border', () => {
    const q = summariseQuarter(issued, '2026-08');
    expect(q.byRate).toEqual([
      { rateBp: 1800, taxablePaise: 10840000, cgstPaise: 885600, sgstPaise: 885600, igstPaise: 180000 },
      { rateBp: 1200, taxablePaise: 1400000, cgstPaise: 84000, sgstPaise: 84000, igstPaise: 0 },
    ]);
  });

  it('lists company bills by GSTIN and counts the rest as B2C', () => {
    const q = summariseQuarter(issued, '2026-08');
    expect(q.b2b.map((r) => [r.gstin, r.bills, r.totalPaise])).toEqual([
      ['27AAPFU0939F1ZV', 2, 5900000 + 5711200],
      ['29AABCG1234H1Z3', 1, 1180000],
    ]);
    expect(q.b2cBills).toBe(1);
    expect(q.b2cPaise).toBe(1568000);
  });

  it('writes the CSV the CA opens', () => {
    const csv = quarterCsv(issued, '2026-08', { name: 'Sharma Electricals', gstin: '27AAAAA0000A1Z5' });
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Sharma Electricals,GSTIN 27AAAAA0000A1Z5,Sales Jul-Sep 2026-27,2026-07-01 to 2026-09-30');
    expect(lines[2]).toBe('Bill no.,Date,Customer,Customer GSTIN,Place of supply,Taxable value,CGST,SGST/UTGST,IGST,Total');
    expect(lines[3]).toBe('INV-1,2026-07-10,Customer 1,27AAPFU0939F1ZV,27,50000.00,4500.00,4500.00,0.00,59000.00');
    expect(csv).toContain('18%,108400.00,8856.00,8856.00,1800.00');
    expect(csv).toContain('not a filed return');
    expect(csv).not.toContain('INV-5');
  });
});
