/**
 * "Apne baare mein batayen": the five fields, checked the same way in the
 * browser and on the server, with messages from the dictionary.
 */
import { describe, expect, it } from 'vitest';

import { formatPhone, parseProfile, toE164 } from '@/lib/domain/profile';

const good = { name: 'Sharma Electricals', phone: '98765 43210', gstin: '', upiId: 'sharma@upi', city: 'Pune', stateCode: '27' };

describe('the phone number', () => {
  it('takes the ten digits however they are typed and stores +91', () => {
    expect(toE164('9876543210')).toBe('+919876543210');
    expect(toE164('98765 43210')).toBe('+919876543210');
    expect(toE164('+91 98765-43210')).toBe('+919876543210');
    expect(toE164('09876543210')).toBe('+919876543210');
    expect(toE164('919876543210')).toBe('+919876543210');
  });

  it('refuses anything that is not an Indian mobile', () => {
    expect(toE164('12345')).toBeNull();
    expect(toE164('1234567890')).toBeNull();
    expect(toE164('+44 7700 900123')).toBeNull();
    expect(toE164('')).toBeNull();
  });

  it('reads back the way people say numbers', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
    expect(formatPhone(null)).toBe('');
  });
});

describe('the profile', () => {
  it('accepts the five fields and works out GST status from the number', () => {
    const r = parseProfile(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile).toEqual({
      name: 'Sharma Electricals',
      phone: '+919876543210',
      gstin: null,
      upiId: 'sharma@upi',
      city: 'Pune',
      stateCode: '27',
      registrationType: 'not-registered',
    });
  });

  it('is registered when there is a GST number, and takes the state from it', () => {
    const r = parseProfile({ ...good, gstin: '27aapfu0939f1zv', stateCode: '' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile.gstin).toBe('27AAPFU0939F1ZV');
    expect(r.profile.stateCode).toBe('27');
    expect(r.profile.registrationType).toBe('regular');
  });

  it('needs only a name and a phone', () => {
    const r = parseProfile({ name: 'Ramesh', phone: '9876543210' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile).toMatchObject({ gstin: null, upiId: null, city: null, stateCode: null });
  });

  it('says which field is wrong, in Hinglish', () => {
    expect(parseProfile({ ...good, name: '  ' })).toEqual({ ok: false, field: 'name', message: 'Yeh zaroori hai' });
    expect(parseProfile({ ...good, phone: '12345' })).toMatchObject({ field: 'phone', message: /10 digit/ });
    expect(parseProfile({ ...good, gstin: 'NOTAGSTIN' })).toMatchObject({ field: 'gstin', message: /GST number theek nahi/ });
    expect(parseProfile({ ...good, upiId: 'no-at-sign' })).toMatchObject({ field: 'upiId', message: /naam@bank/ });
    expect(parseProfile({ ...good, stateCode: '99' })).toMatchObject({ field: 'stateCode', message: /rajya/ });
    expect(parseProfile({ ...good, name: 'x'.repeat(121) })).toMatchObject({ field: 'name', message: /120/ });
  });

  it('will not let the state disagree with the GST number', () => {
    const r = parseProfile({ ...good, gstin: '27AAPFU0939F1ZV', stateCode: '29' });
    expect(r).toMatchObject({ ok: false, field: 'stateCode' });
    if (r.ok) return;
    expect(r.message).toContain('Maharashtra');
    expect(r.message).toContain('Karnataka');
  });

  it('tidies what it keeps', () => {
    const r = parseProfile({ ...good, name: '  Sharma   Electricals ', city: ' Pune ', upiId: ' sharma@upi ' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile.name).toBe('Sharma Electricals');
    expect(r.profile.city).toBe('Pune');
    expect(r.profile.upiId).toBe('sharma@upi');
  });
});
