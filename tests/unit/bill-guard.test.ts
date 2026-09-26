import { describe, expect, it } from 'vitest';

import { findDuplicate, previewNumber, proportionalCredit, rateOddities, suggestNumbering } from '@/lib/domain/bill-guard';
import type { InvoiceRecord } from '@/lib/domain/types';

const issued = (id: string, customerId: string | null, name: string, issueDate: string, total: number): InvoiceRecord =>
  ({ id, status: 'issued', number: `INV-${id}`, issueDate, customer: { customerId, name }, totals: { grandTotalPaise: total } }) as unknown as InvoiceRecord;

describe('yeh bill pehle ban chuka hai?', () => {
  const recent = [issued('41', 'c1', 'Mehta Traders', '2026-09-22', 620000), issued('35', 'c1', 'Mehta Traders', '2026-08-22', 620000), issued('42', 'c2', 'Priya', '2026-09-25', 620000)];

  it('finds the same customer, same amount, within a week', () => {
    expect(findDuplicate({ customerId: 'c1', customerName: 'Mehta Traders', grandTotalPaise: 620000, today: '2026-09-26' }, recent)).toMatchObject({ number: 'INV-41', issueDate: '2026-09-22' });
  });

  it('lets a month-old bill or a different amount through', () => {
    expect(findDuplicate({ customerId: 'c1', customerName: 'Mehta Traders', grandTotalPaise: 620000, today: '2026-10-20' }, recent)).toBeNull();
    expect(findDuplicate({ customerId: 'c1', customerName: 'Mehta Traders', grandTotalPaise: 620100, today: '2026-09-26' }, recent)).toBeNull();
  });

  it('matches a walk-in by name when there is no record', () => {
    const walkIn = [issued('50', null, 'Anil Kumar', '2026-09-25', 50000)];
    expect(findDuplicate({ customerId: null, customerName: 'anil kumar', grandTotalPaise: 50000, today: '2026-09-26' }, walkIn)?.number).toBe('INV-50');
  });
});

describe('rate check', () => {
  const last = [{ description: 'AMC visit', unitPricePaise: 350000 }, { description: 'Fan', unitPricePaise: 135000 }] as never;
  it('flags a missing or extra zero, not an ordinary change', () => {
    expect(rateOddities([{ id: '1', what: 'AMC visit', qty: '1', rate: '350' }], last)).toEqual([{ what: 'AMC visit', lastRatePaise: 350000, nowRatePaise: 35000 }]);
    expect(rateOddities([{ id: '1', what: 'amc  VISIT', qty: '1', rate: '35,000' }], last)).toHaveLength(1);
    expect(rateOddities([{ id: '1', what: 'AMC visit', qty: '1', rate: '3800' }], last)).toEqual([]);
    expect(rateOddities([{ id: '1', what: 'New thing', qty: '1', rate: '5' }], last)).toEqual([]);
  });
});

describe('bill numbers', () => {
  it('previews the next number the way the engine writes it', () => {
    expect(previewNumber({ prefix: 'INV-', nextNumber: 43, padding: 3, includeFinancialYear: false }, '2026-27')).toBe('INV-043');
    expect(previewNumber({ prefix: 'SE/', nextNumber: 7, padding: 2, includeFinancialYear: true }, '2026-27')).toBe('SE/2026-27/07');
  });

  it('continues from the old bills that were uploaded', () => {
    expect(suggestNumbering(['INV/2025-26/041', 'INV/2025-26/042', 'INV/2025-26/040'])).toEqual({
      last: 'INV/2025-26/042',
      series: { prefix: 'INV/', nextNumber: 43, padding: 3, includeFinancialYear: true },
    });
    expect(suggestNumbering(['SE-7', 'SE-12', null, 'quote'])).toEqual({ last: 'SE-12', series: { prefix: 'SE-', nextNumber: 13, padding: 2, includeFinancialYear: false } });
    expect(suggestNumbering([])).toBeNull();
    expect(suggestNumbering(['Bill number 4'])).toBeNull();
  });
});

describe('a credit note against a GST bill', () => {
  it('reduces taxable value and each tax in the bill\'s proportion, and adds up', () => {
    const totals = { grandTotalPaise: 118000, taxableValuePaise: 100000, cgstPaise: 9000, sgstPaise: 9000, igstPaise: 0, cessPaise: 0 } as never;
    const split = proportionalCredit(totals, 59000);
    expect(split).toEqual({ taxableValuePaise: 50000, cgstPaise: 4500, sgstPaise: 4500, igstPaise: 0, cessPaise: 0 });
    expect(split.taxableValuePaise + split.cgstPaise + split.sgstPaise).toBe(59000);
  });
  it('is all taxable value on a bill without GST', () => {
    expect(proportionalCredit({ grandTotalPaise: 205000, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 0 } as never, 5000)).toMatchObject({ taxableValuePaise: 5000 });
  });
});
