/**
 * The five things an owner tells us about themselves, and nothing else.
 *
 * "Apne baare mein batayen": a name, the phone they signed in with, a GST
 * number if they have one, a UPI ID so customers can pay, and where they are.
 * Everything a bill needs, and no more -- the address, the bank account and the
 * numbering all keep their defaults until the owner has a reason to change
 * them.
 *
 * This module is pure so the same checks run in the browser as the owner types
 * and on the server before anything is written, and so every message comes
 * from the dictionary rather than being invented twice.
 */
import { t } from '@/lib/copy';
import { checkGstin } from '@/lib/gst/gstin';
import { findState, stateName } from '@/lib/gst/state-codes';

export interface ProfileInput {
  name: string;
  /** Ten digits, or +91 and ten digits; spaces and dashes are forgiven. */
  phone: string;
  gstin?: string | null;
  upiId?: string | null;
  city?: string | null;
  stateCode?: string | null;
}

export type ProfileField = keyof ProfileInput;

export interface Profile {
  name: string;
  /** E.164, always "+91..." -- the form Firebase Auth carries. */
  phone: string;
  gstin: string | null;
  upiId: string | null;
  city: string | null;
  stateCode: string | null;
  /** Follows from the GST number: registered if there is one, not if not. */
  registrationType: 'regular' | 'not-registered';
}

export type ProfileCheck = { ok: true; profile: Profile } | { ok: false; field: ProfileField; message: string };

const NAME_MAX = 120;
const CITY_MAX = 100;

/** Indian mobile numbers: ten digits, first one 6 to 9. */
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/** A UPI VPA: "sharma@upi", "9876543210@ybl". The handle is letters only. */
const UPI_ID = /^[\w.\-]{2,60}@[a-zA-Z]{2,30}$/;

/** "+91 98765 43210" -> "+919876543210", or null if it is not an Indian mobile. */
export function toE164(raw: string): string | null {
  const digits = raw.replace(/[\s\-()]/g, '').replace(/^\+?91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '');
  return INDIAN_MOBILE.test(digits) ? `+91${digits}` : null;
}

/** "+919876543210" -> "+91 98765 43210". The shape people read numbers in. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

function clean(v: string | null | undefined): string {
  return (v ?? '').trim();
}

export function parseProfile(input: ProfileInput): ProfileCheck {
  const name = clean(input.name).replace(/\s+/g, ' ');
  if (!name) return { ok: false, field: 'name', message: t('error.required') };
  if (name.length > NAME_MAX) return { ok: false, field: 'name', message: t('error.tooLong', { n: NAME_MAX }) };

  const phone = toE164(clean(input.phone));
  if (!phone) return { ok: false, field: 'phone', message: t('error.phone') };

  const city = clean(input.city) || null;
  if (city && city.length > CITY_MAX) return { ok: false, field: 'city', message: t('error.tooLong', { n: CITY_MAX }) };

  const upiId = clean(input.upiId) || null;
  if (upiId && !UPI_ID.test(upiId)) return { ok: false, field: 'upiId', message: t('error.upi') };

  let stateCode = clean(input.stateCode) || null;
  if (stateCode && !findState(stateCode)) return { ok: false, field: 'stateCode', message: t('error.state') };

  let gstin: string | null = null;
  const rawGstin = clean(input.gstin);
  if (rawGstin) {
    const check = checkGstin(rawGstin);
    if (!check.ok) return { ok: false, field: 'gstin', message: t('error.gstin') };
    gstin = check.normalised;
    // A GST number carries its state in its first two digits. If the owner
    // also picked a state and the two disagree, say so; a wrong state puts the
    // wrong tax on every bill after this one.
    if (stateCode && stateCode !== check.stateCode) {
      return {
        ok: false,
        field: 'stateCode',
        message: t('error.gstinState', { gstState: check.stateName!, chosen: stateName(stateCode) }),
      };
    }
    stateCode = check.stateCode!;
  }

  return {
    ok: true,
    profile: { name, phone, gstin, upiId, city, stateCode, registrationType: gstin ? 'regular' : 'not-registered' },
  };
}
