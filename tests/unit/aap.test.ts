import { describe, expect, it } from 'vitest';

import { parseAap, type AapInput } from '@/lib/domain/aap';

const base: AapInput = {
  name: 'Sharma Electricals',
  phone: '9876543210',
  gstin: '',
  upiId: '',
  city: 'Pune',
  stateCode: '27',
  eInvoicingApplies: null,
  prefix: 'INV',
  nextNumber: '5',
  includeFinancialYear: false,
  paymentTermsDays: 15,
};

const check = (patch: Partial<AapInput>, minNextNumber = 1) => parseAap({ ...base, ...patch }, { minNextNumber });

describe('parseAap: the whole Aap screen, one check', () => {
  it('accepts the basics with everything optional left empty', () => {
    const r = check({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.addressLine1).toBeNull();
    expect(r.value.bank).toEqual({ accountHolderName: null, accountNumber: null, ifsc: null, bankName: null });
    expect(r.value.numbering).toEqual({ prefix: 'INV', nextNumber: 5, includeFinancialYear: false });
    expect(r.value.paymentTermsDays).toBe(15);
  });

  it('reports profile problems first, on the profile field', () => {
    const r = check({ name: '' });
    expect(r).toMatchObject({ ok: false, field: 'name' });
  });

  it('checks the PIN code', () => {
    expect(check({ pincode: '411 001' })).toMatchObject({ ok: true, value: { pincode: '411001' } });
    expect(check({ pincode: '01100' })).toMatchObject({ ok: false, field: 'pincode' });
  });

  it('checks the email only when given', () => {
    expect(check({ email: 'a@b.in' }).ok).toBe(true);
    expect(check({ email: 'not an email' })).toMatchObject({ ok: false, field: 'email' });
  });

  it('cleans and checks the bank account', () => {
    const r = check({ accountNumber: '1234 5678 9012', ifsc: 'sbin0001234', bankName: 'SBI', accountHolderName: 'Sharma Electricals' });
    expect(r).toMatchObject({ ok: true, value: { bank: { accountNumber: '123456789012', ifsc: 'SBIN0001234' } } });
    expect(check({ accountNumber: '12ab' })).toMatchObject({ ok: false, field: 'accountNumber' });
    expect(check({ ifsc: 'SBIN1001234' })).toMatchObject({ ok: false, field: 'ifsc' });
  });

  it('never lets the next bill number go below what is already used', () => {
    expect(check({ nextNumber: '3' }, 4)).toMatchObject({ ok: false, field: 'nextNumber' });
    expect(check({ nextNumber: '4' }, 4).ok).toBe(true);
    expect(check({ nextNumber: '' }, 1)).toMatchObject({ ok: false, field: 'nextNumber' });
  });

  it('keeps the prefix short and plain', () => {
    expect(check({ prefix: 'SE/25-' }).ok).toBe(true);
    expect(check({ prefix: 'TOO LONG PREFIX' })).toMatchObject({ ok: false, field: 'prefix' });
  });

  it('offers only the listed payment terms', () => {
    expect(check({ paymentTermsDays: '30' }).ok).toBe(true);
    expect(check({ paymentTermsDays: 45 })).toMatchObject({ ok: false, field: 'paymentTermsDays' });
  });
});
