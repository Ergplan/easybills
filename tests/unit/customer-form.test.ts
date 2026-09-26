import { describe, expect, it } from 'vitest';

import { parseCustomer } from '@/lib/domain/customer-form';

describe('customer ke baare mein', () => {
  it('needs only a name', () => {
    const r = parseCustomer({ name: ' Mehta  Traders ' });
    expect(r.ok && r.customer).toMatchObject({ name: 'Mehta Traders', gstin: null, pan: null, stateCode: null, language: null });
  });

  it('takes the state, and the PAN, from the GST number', () => {
    const r = parseCustomer({ name: 'Mehta Traders', gstin: '27aapfu0939f1zv' });
    expect(r.ok && r.customer).toMatchObject({ gstin: '27AAPFU0939F1ZV', stateCode: '27', pan: 'AAPFU0939F' });
  });

  it('refuses a state that disagrees with the GST number, or a PAN that does', () => {
    expect(parseCustomer({ name: 'X', gstin: '27AAPFU0939F1ZV', stateCode: '29' })).toMatchObject({ ok: false, field: 'stateCode' });
    expect(parseCustomer({ name: 'X', gstin: '27AAPFU0939F1ZV', pan: 'ABCDE1234F' })).toMatchObject({ ok: false, field: 'pan' });
  });

  it('checks the shape of a PAN and a phone, in Hinglish', () => {
    expect(parseCustomer({ name: 'X', pan: 'nope' })).toMatchObject({ ok: false, field: 'pan', message: 'PAN aisa dikhta hai: ABCDE1234F' });
    expect(parseCustomer({ name: 'X', phone: '12345' })).toMatchObject({ ok: false, field: 'phone' });
    expect(parseCustomer({ name: 'X', phone: '98765 43210' }).ok && parseCustomer({ name: 'X', phone: '98765 43210' })).toMatchObject({ customer: { phone: '+919876543210' } });
  });

  it('keeps a language it knows and drops one it does not', () => {
    expect(parseCustomer({ name: 'X', language: 'mr' })).toMatchObject({ customer: { language: 'mr' } });
    expect(parseCustomer({ name: 'X', language: '' })).toMatchObject({ customer: { language: null } });
  });
});
