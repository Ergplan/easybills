/**
 * Poocho: the text a bill and a contract become, how long text is cut, how a
 * Hinglish question becomes a word search, and how answers cite records.
 */
import { describe, expect, it } from 'vitest';

import type { InvoiceRecord, ProjectRecord } from '@/lib/domain/types';
import { billDocument, chunkText, citationsIn, fuseRanks, projectDocument, tsQueryFor } from '@/lib/search/documents';

const bill = {
  id: 'inv-1',
  number: 'INV-007',
  status: 'issued',
  issueDate: '2026-09-12',
  dueDate: '2026-09-19',
  customer: { customerId: 'c1', name: 'Sharma Electricals', city: 'Nagpur' },
  lines: [
    { description: 'AMC visit', quantityMilli: 1000, unitPricePaise: 350000, taxRateBp: 1800, taxRateChosen: true },
    { description: 'Ceiling fan install', quantityMilli: 2000, unitPricePaise: 135000, taxRateBp: 1800, taxRateChosen: true },
  ],
  totals: { taxableValuePaise: 620000, totalTaxPaise: 111600, grandTotalPaise: 731600 },
  amountPaidPaise: 300000,
  balancePaise: 431600,
  cancelledReason: null,
  projectStage: null,
  notes: null,
  updatedAt: '2026-09-12T10:00:00.000Z',
} as unknown as InvoiceRecord;

describe('a bill as text', () => {
  const doc = billDocument(bill, [
    { kind: 'credit-note', number: 'CN-001', amountPaise: 5000, reason: 'ek item do baar laga' } as never,
  ]);

  it('says who, what, at what rate, when and what is left', () => {
    expect(doc.text).toContain('Bill INV-007 dated 12 Sep 2026 to Sharma Electricals (Nagpur).');
    expect(doc.text).toContain('AMC visit: 1 x ₹3,500 = ₹3,500, GST 18%');
    expect(doc.text).toContain('Ceiling fan install: 2 x ₹1,350 = ₹2,700');
    expect(doc.text).toContain('Total ₹7,316.');
    expect(doc.text).toContain('Received ₹3,000.');
    expect(doc.text).toContain('Still to come: ₹4,316, due 19 Sep 2026.');
    expect(doc.text).toContain('Credit note CN-001 for ₹50: ek item do baar laga.');
  });

  it('is keyed to the bill, so a change replaces it', () => {
    expect(doc).toMatchObject({ id: 'bill:inv-1', kind: 'bill', sourceId: 'inv-1', href: '/bills/inv-1' });
    expect(doc.sourceUpdatedAt).toBe(bill.updatedAt);
  });

  it('says so when the bill was cancelled, and claims nothing is owed', () => {
    const c = billDocument({ ...bill, status: 'cancelled', cancelledReason: 'galat rate' } as InvoiceRecord);
    expect(c.text).toContain('This bill was cancelled (galat rate).');
    expect(c.text).not.toContain('Still to come');
  });
});

describe('a contract as text', () => {
  it('carries the value, GST, instalments and retention', () => {
    const p = {
      id: 'p1',
      customerId: 'c9',
      customerName: 'Green Park Society',
      name: 'Lift renovation',
      totalPaise: 50000000,
      gstMode: 'extra',
      gstRateBp: 1800,
      billing: 'milestones',
      milestones: [
        { id: 'm1', label: 'Advance', pctBp: 3000 },
        { id: 'm2', label: 'Delivery', pctBp: 4000 },
        { id: 'm3', label: 'Installation', pctBp: 3000 },
      ],
      retentionBp: 500,
      status: 'active',
      updatedAt: 'x',
    } as unknown as ProjectRecord;
    const d = projectDocument(p);
    expect(d.text).toBe(
      'Contract "Lift renovation" with Green Park Society: ₹5,00,000 plus GST 18%. ' +
        'Billed in instalments: Advance 30%, Delivery 40%, Installation 30%. Retention 5% held back until the end.',
    );
    expect(d.href).toBe('/customers/c9');
  });
});

describe('chunking', () => {
  it('keeps short text whole and drops empty text', () => {
    expect(chunkText('Bill to Asha Rao')).toEqual(['Bill to Asha Rao']);
    expect(chunkText('  \n ')).toEqual([]);
  });

  it('cuts long text at line or sentence ends, with overlap, losing nothing', () => {
    const lines = Array.from({ length: 80 }, (_, i) => `Line ${i}: AMC visit for flat ${i}, ₹${1000 + i}.`);
    const chunks = chunkText(lines.join('\n'), 400, 60);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(400);
    for (const l of lines) expect(chunks.some((c) => c.includes(l))).toBe(true);
  });
});

describe('a question as a word search', () => {
  it('keeps the words that mean something, as prefixes, any of them', () => {
    expect(tsQueryFor('Sharma ji ko pichli baar AMC ka kya rate diya tha?')).toBe('sharma:* | amc:* | rate:*');
  });

  it('keeps bill numbers usable', () => {
    expect(tsQueryFor('INV-007 kab gaya')).toBe('inv:* | 007:* | gaya:*');
  });

  it('has nothing to search for in pure glue words', () => {
    expect(tsQueryFor('kya hai?')).toBeNull();
  });

  it("cannot be used to inject tsquery syntax", () => {
    expect(tsQueryFor("rate' & !(x) | y:*")).toBe('rate:*');
  });
});

describe('fusing the two searches', () => {
  it('puts what both rank high on top', () => {
    expect(fuseRanks([['a', 'b', 'c'], ['b', 'd']])[0]).toBe('b');
    expect(fuseRanks([['a'], []])).toEqual(['a']);
  });
});

describe('citations', () => {
  it('reads the record numbers an answer cites, once each, and ignores ones that do not exist', () => {
    expect(citationsIn('₹3,500 tha [2], aur pehle bhi [2] [1]. [9]', 3)).toEqual([2, 1]);
  });
});
