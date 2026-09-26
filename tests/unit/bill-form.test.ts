/**
 * The bill in three fields: what the owner types becomes lines the engine
 * prices, and what is wrong is said in Hinglish.
 */
import { describe, expect, it } from 'vitest';

import { blankLine, checkBill, linesToDraft, subtotalOf, summariseLines } from '@/lib/domain/bill-form';
import type { InvoiceLine } from '@/lib/domain/types';

const line = (what: string, qty: string, rate: string) => ({ id: what, what, qty, rate });
const opts = { needsCustomerName: false, chargesGst: false };

describe('checkBill', () => {
  it('turns the three fields into priced lines', () => {
    const r = checkBill({ customerName: '', customerPhone: '', customerGstin: '', gstRateBp: null, lines: [line('AMC visit', '1', '3,500'), line('Fan', '2', '1350')] }, opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines.map((l) => [l.description, l.quantityMilli, l.unitPricePaise, l.taxRateBp, l.taxRateChosen])).toEqual([
      ['AMC visit', 1000, 350000, 0, true],
      ['Fan', 2000, 135000, 0, true],
    ]);
  });

  it('ignores a line nobody touched, but not a half-filled one', () => {
    const ok = checkBill({ customerName: '', customerPhone: '', customerGstin: '', gstRateBp: null, lines: [line('Visit', '1', '500'), blankLine('x')] }, opts);
    expect(ok.ok).toBe(true);
    const half = checkBill({ customerName: '', customerPhone: '', customerGstin: '', gstRateBp: null, lines: [line('Visit', '1', '')] }, opts);
    expect(half).toMatchObject({ ok: false, problem: { field: 'rate', lineId: 'Visit' }, message: 'Rakam theek se likho' });
  });

  it('needs at least one thing done', () => {
    expect(checkBill({ customerName: '', customerPhone: '', customerGstin: '', gstRateBp: null, lines: [blankLine('a')] }, opts)).toMatchObject({
      ok: false,
      problem: { field: 'lines' },
      message: 'Kam se kam ek kaam likho',
    });
  });

  it('asks the new customer for a name', () => {
    expect(checkBill({ customerName: '  ', customerPhone: '', customerGstin: '', gstRateBp: null, lines: [line('Visit', '1', '500')] }, { ...opts, needsCustomerName: true })).toMatchObject({
      ok: false,
      problem: { field: 'customerName' },
    });
  });

  it('refuses a quantity of zero or a rate that is not a number', () => {
    expect(checkBill({ customerName: '', customerPhone: '', customerGstin: '', gstRateBp: null, lines: [line('Visit', '0', '500')] }, opts)).toMatchObject({ problem: { field: 'qty' } });
    expect(checkBill({ customerName: '', customerPhone: '', customerGstin: '', gstRateBp: null, lines: [line('Visit', '1', 'five')] }, opts)).toMatchObject({ problem: { field: 'rate' } });
  });

  it('puts one GST rate on every line for a registered owner, and knows when none was chosen', () => {
    const chosen = checkBill({ customerName: '', customerPhone: '', customerGstin: '', gstRateBp: 1800, lines: [line('Visit', '1', '500')] }, { ...opts, chargesGst: true });
    expect(chosen.ok && chosen.lines[0]).toMatchObject({ taxRateBp: 1800, taxRateChosen: true });
    const none = checkBill({ customerName: '', customerPhone: '', customerGstin: '', gstRateBp: null, lines: [line('Visit', '1', '500')] }, { ...opts, chargesGst: true });
    expect(none.ok && none.lines[0]).toMatchObject({ taxRateBp: 0, taxRateChosen: false });
  });
});

describe('the running total', () => {
  it('adds what makes sense and skips what is half typed', () => {
    expect(subtotalOf([line('a', '2', '800'), line('b', '1', '450'), line('c', '1', '4x'), blankLine('d')])).toBe(205000);
  });
});

describe('pichle jaisa hi', () => {
  const lines: InvoiceLine[] = [
    { id: '1', description: 'AMC visit', quantityMilli: 1000, unitPricePaise: 350000, discountPaise: 0, taxRateBp: 0, taxRateChosen: true, cessRateBp: 0, priceIncludesTax: false, unit: null, hsnCode: null, savedItemId: null },
    { id: '2', description: 'Ceiling fan install', quantityMilli: 2000, unitPricePaise: 135000, discountPaise: 0, taxRateBp: 0, taxRateChosen: true, cessRateBp: 0, priceIncludesTax: false, unit: null, hsnCode: null, savedItemId: null },
  ];

  it('describes last time in a few words', () => {
    expect(summariseLines(lines)).toBe('AMC visit + 2 Ceiling fan install');
    expect(summariseLines([...lines, ...lines])).toBe('AMC visit + 2 Ceiling fan install + AMC visit + 1');
  });

  it('puts last time back into the three fields', () => {
    let n = 0;
    expect(linesToDraft(lines, () => `new-${n++}`)).toEqual([
      { id: 'new-0', what: 'AMC visit', qty: '1', rate: '3500' },
      { id: 'new-1', what: 'Ceiling fan install', qty: '2', rate: '1350' },
    ]);
  });
});
