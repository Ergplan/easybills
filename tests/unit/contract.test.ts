/**
 * "Mera bill thoda complex hai": the contract helper's arithmetic and its
 * reading of typed terms.
 */
import { describe, expect, it } from 'vitest';

import {
  billedCumulativeBp,
  checkTerms,
  milestoneStatus,
  parseAmount,
  parseContractText,
  planMilestoneBill,
  planProgressBill,
  type BilledEntry,
  type ContractTerms,
} from '@/lib/domain/contract';

const RATES = [0, 500, 1200, 1800, 2800];
const lakh = (n: number) => Math.round(n * 100000 * 100);

const terms: ContractTerms = {
  name: 'Green Park lift renovation',
  totalPaise: lakh(5),
  gstMode: 'extra',
  gstRateBp: 1800,
  billing: 'milestones',
  milestones: [
    { id: 'm1', label: 'Advance', pctBp: 3000 },
    { id: 'm2', label: 'On delivery', pctBp: 4000 },
    { id: 'm3', label: 'On installation', pctBp: 3000 },
  ],
  retentionBp: 500,
};

const billed = (milestoneId: string | null, basisPaise: number, extra: Partial<BilledEntry> = {}): BilledEntry => ({
  invoiceId: `i-${milestoneId}`,
  number: `INV-${milestoneId}`,
  milestoneId,
  basisPaise,
  cumulativeBp: null,
  status: 'issued',
  ...extra,
});

describe('amounts the way people say them', () => {
  it.each([
    ['5 lakh', lakh(5)],
    ['2.5L', lakh(2.5)],
    ['₹5,00,000/-', lakh(5)],
    ['500000', lakh(5)],
    ['1 crore', lakh(100)],
    ['50k', 5000000],
    ['75 hazaar', 7500000],
  ])('%s', (raw, paise) => expect(parseAmount(raw)).toBe(paise));

  it('refuses what is not an amount', () => {
    expect(parseAmount('lots')).toBeNull();
    expect(parseAmount('0')).toBeNull();
  });
});

describe('the deal', () => {
  it('accepts instalments that add up to 100%, and nothing else', () => {
    expect(checkTerms(terms, { chargesGst: true, allowedRatesBp: RATES }).ok).toBe(true);
    const short = { ...terms, milestones: terms.milestones.slice(0, 2) };
    expect(checkTerms(short, { chargesGst: true, allowedRatesBp: RATES })).toMatchObject({ ok: false, field: 'milestones', message: 'Kisto ka total 100% hona chahiye. Abhi 70% hai.' });
  });

  it('drops GST from the deal of an owner who does not charge it', () => {
    const r = checkTerms(terms, { chargesGst: false, allowedRatesBp: RATES });
    expect(r.ok && r.terms).toMatchObject({ gstMode: 'none', gstRateBp: null });
  });

  it('asks the rate when GST is charged and none is chosen', () => {
    expect(checkTerms({ ...terms, gstRateBp: null }, { chargesGst: true, allowedRatesBp: RATES })).toMatchObject({ ok: false, field: 'gstRateBp' });
  });
});

describe('an instalment bill', () => {
  it('is the percentage of the contract, with GST on top and the retention worked out', () => {
    const r = planMilestoneBill(terms, 'm1', []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bill).toMatchObject({
      basisPaise: lakh(1.5),
      linePaise: lakh(1.5),
      gstPaise: 2700000,
      totalPaise: 17700000,
      billedBeforePaise: 0,
      remainingAfterPaise: lakh(3.5),
      retentionPaise: 885000,
    });
    expect(r.bill.description).toBe('Green Park lift renovation - Advance (instalment 1 of 3: 30% of contract value ₹5,00,000)');
    expect(r.bill.notes).toContain('Billed before this bill: ₹0. This bill: ₹1,50,000. Balance of contract after this bill: ₹3,50,000.');
    expect(r.bill.notes).toContain('Retention: 5% of this bill (₹8,850) is payable on completion.');
    expect(r.bill.working[0]).toBe('Is bill: ₹5,00,000 ka 30% = ₹1,50,000');
  });

  it('knows what was billed before', () => {
    const r = planMilestoneBill(terms, 'm2', [billed('m1', lakh(1.5))]);
    expect(r.ok && r.bill).toMatchObject({ basisPaise: lakh(2), billedBeforePaise: lakh(1.5), remainingAfterPaise: lakh(1.5) });
  });

  it('never bills an instalment twice', () => {
    expect(planMilestoneBill(terms, 'm1', [billed('m1', lakh(1.5))])).toEqual({ ok: false, message: 'Is kist ka bill ban chuka: INV-m1.' });
  });

  it('makes the last instalment whatever is left, so thirds add up to the rupee', () => {
    const thirds: ContractTerms = {
      ...terms,
      gstMode: 'none',
      gstRateBp: null,
      retentionBp: 0,
      totalPaise: 10000000,
      milestones: [
        { id: 'a', label: 'One', pctBp: 3333 },
        { id: 'b', label: 'Two', pctBp: 3333 },
        { id: 'c', label: 'Three', pctBp: 3334 },
      ],
    };
    const a = planMilestoneBill(thirds, 'a', []);
    const b = planMilestoneBill(thirds, 'b', [billed('a', 3333000)]);
    const c = planMilestoneBill(thirds, 'c', [billed('a', 3333000), billed('b', 3333000)]);
    expect([a, b, c].map((x) => x.ok && x.bill.basisPaise)).toEqual([3333000, 3333000, 3334000]);
    expect(c.ok && c.bill.remainingAfterPaise).toBe(0);
  });

  it('takes GST out of the amount when it is inside the contract value', () => {
    const r = planMilestoneBill({ ...terms, gstMode: 'included' }, 'm1', []);
    expect(r.ok && r.bill).toMatchObject({ basisPaise: lakh(1.5), linePaise: 12711864, gstPaise: 2288136, totalPaise: lakh(1.5) });
  });

  it('shows each instalment as billed, started or pending', () => {
    const s = milestoneStatus(terms, [billed('m1', lakh(1.5)), billed('m2', 0, { status: 'draft', number: null })]);
    expect(s.map((x) => x.state)).toEqual(['billed', 'draft', 'pending']);
  });
});

describe('a running bill, as the work gets done', () => {
  const progress: ContractTerms = { ...terms, billing: 'progress', milestones: [], gstMode: 'none', gstRateBp: null, retentionBp: 1000 };

  it('bills the work done since the last bill', () => {
    const first = planProgressBill(progress, 4000, []);
    expect(first.ok && first.bill).toMatchObject({ basisPaise: lakh(2), cumulativeBp: 4000, retentionPaise: lakh(0.2) });
    const second = planProgressBill(progress, 6500, [billed(null, lakh(2), { cumulativeBp: 4000 })]);
    expect(second.ok && second.bill).toMatchObject({ basisPaise: lakh(1.25), billedBeforePaise: lakh(2), remainingAfterPaise: lakh(1.75) });
    expect(second.ok && second.bill.description).toContain('running bill 2: work completed to 65%');
  });

  it('refuses a percentage already billed', () => {
    expect(planProgressBill(progress, 3000, [billed(null, lakh(2), { cumulativeBp: 4000 })])).toEqual({ ok: false, message: 'Naya kuch nahi: 40% ka bill pehle se bana hai.' });
    expect(billedCumulativeBp(progress, [billed(null, lakh(2), { cumulativeBp: 4000 })])).toBe(4000);
  });

  it('bills exactly what is left at 100%', () => {
    const r = planProgressBill({ ...progress, totalPaise: 10000001 }, 10000, [billed(null, 3333333, { cumulativeBp: 3333 })]);
    expect(r.ok && r.bill.basisPaise).toBe(10000001 - 3333333);
  });
});

describe('reading the terms the owner typed', () => {
  it('reads the common shape, in English', () => {
    const p = parseContractText('Contract value 5 lakh plus GST 18%. 30% advance, 40% on delivery, 30% after installation. 5% retention.', RATES);
    expect(p).toEqual({
      name: null,
      totalPaise: lakh(5),
      gstMode: 'extra',
      gstRateBp: 1800,
      billing: 'milestones',
      milestones: [
        { label: 'Advance', pctBp: 3000 },
        { label: 'Delivery', pctBp: 4000 },
        { label: 'Installation', pctBp: 3000 },
      ],
      retentionBp: 500,
    });
  });

  it('reads it in Hinglish too', () => {
    const p = parseContractText('Poora kaam 2.5 lakh ka, GST saath mein. 50% advance aur baaki 50% kaam poora hone par.', RATES);
    expect(p.totalPaise).toBe(lakh(2.5));
    expect(p.gstMode).toBe('included');
    expect(p.milestones.map((m) => m.pctBp)).toEqual([5000, 5000]);
    expect(p.milestones[0]!.label).toBe('Advance');
  });

  it('turns an amount instalment into a share of the total', () => {
    const p = parseContractText('Total order value Rs 4,00,000. Advance 1 lakh, balance on delivery 3 lakh.', RATES);
    expect(p.totalPaise).toBe(lakh(4));
    expect(p.milestones.map((m) => m.pctBp)).toEqual([2500, 7500]);
  });

  it('recognises a running-bill contract', () => {
    const p = parseContractText('Civil work contract 12 lakh. Running bills as per work done every month, 10% retention.', RATES);
    expect(p).toMatchObject({ totalPaise: lakh(12), billing: 'progress', retentionBp: 1000, milestones: [] });
  });

  it('leaves empty what it cannot find', () => {
    expect(parseContractText('kuch bhi', RATES)).toMatchObject({ totalPaise: null, milestones: [], billing: null, gstMode: null });
  });
});
