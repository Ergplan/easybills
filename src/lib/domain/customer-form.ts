/**
 * "Customer ke baare mein batayen": what the owner knows about a customer,
 * checked the same way in the browser and on the server.
 *
 * The GST number does the most work. It carries the customer's state, and
 * the state against the owner's decides whether the bill carries CGST+SGST
 * (same state) or IGST (another state) -- the engine reads it as the place
 * of supply. A customer with one is a company (B2B) bill in the GST
 * summary; without, B2C. PAN is printed on the bill when given.
 */
import { t, type CustomerLanguage } from '@/lib/copy';
import { checkGstin, checkPan } from '@/lib/gst/gstin';
import { findState, stateName } from '@/lib/gst/state-codes';

export interface CustomerInput {
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  gstin?: string | null;
  pan?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  pincode?: string | null;
  stateCode?: string | null;
  language?: CustomerLanguage | '' | null;
}

export type CustomerField = keyof CustomerInput;

export interface CustomerClean {
  name: string;
  contactPerson: string | null;
  phone: string | null;
  gstin: string | null;
  pan: string | null;
  addressLine1: string | null;
  city: string | null;
  pincode: string | null;
  stateCode: string | null;
  language: CustomerLanguage | null;
}

export type CustomerCheck = { ok: true; customer: CustomerClean } | { ok: false; field: CustomerField; message: string };

const LANGUAGES: CustomerLanguage[] = ['hi', 'mr', 'gu', 'ta', 'te', 'kn', 'bn', 'en'];

function clean(v: string | null | undefined, max: number): string | null {
  const s = (v ?? '').trim().replace(/\s+/g, ' ');
  return s ? s.slice(0, max) : null;
}

export function parseCustomer(input: CustomerInput): CustomerCheck {
  const name = clean(input.name, 200);
  if (!name) return { ok: false, field: 'name', message: t('error.required') };

  const phoneRaw = (input.phone ?? '').replace(/[\s\-()]/g, '');
  if (phoneRaw && !/^(\+91)?[6-9]\d{9}$/.test(phoneRaw) && !/^\+\d{6,15}$/.test(phoneRaw)) {
    return { ok: false, field: 'phone', message: t('error.phone') };
  }
  const phone = phoneRaw ? (/^[6-9]\d{9}$/.test(phoneRaw) ? `+91${phoneRaw}` : phoneRaw) : null;

  let stateCode = clean(input.stateCode, 2);
  if (stateCode && !findState(stateCode)) return { ok: false, field: 'stateCode', message: t('error.state') };

  let gstin: string | null = null;
  const rawGstin = (input.gstin ?? '').trim();
  if (rawGstin) {
    const check = checkGstin(rawGstin);
    if (!check.ok) return { ok: false, field: 'gstin', message: t('error.gstin') };
    gstin = check.normalised;
    if (stateCode && stateCode !== check.stateCode) {
      return {
        ok: false,
        field: 'stateCode',
        message: t('error.gstinState', { gstState: check.stateName!, chosen: stateName(stateCode) }),
      };
    }
    stateCode = check.stateCode!;
  }

  let pan: string | null = null;
  const rawPan = (input.pan ?? '').trim();
  if (rawPan) {
    const check = checkPan(rawPan);
    if (!check.ok) return { ok: false, field: 'pan', message: t('error.pan') };
    pan = check.normalised;
    // A GSTIN has the PAN inside it (characters 3 to 12); if both are given they must agree.
    if (gstin && gstin.slice(2, 12) !== pan) return { ok: false, field: 'pan', message: t('error.pan') };
  } else if (gstin) {
    pan = gstin.slice(2, 12);
  }

  const pincode = clean(input.pincode, 10);
  if (pincode && !/^\d{6}$/.test(pincode)) return { ok: false, field: 'pincode', message: t('error.required') };

  const language = input.language && LANGUAGES.includes(input.language as CustomerLanguage) ? (input.language as CustomerLanguage) : null;

  return {
    ok: true,
    customer: {
      name,
      contactPerson: clean(input.contactPerson, 100),
      phone,
      gstin,
      pan,
      addressLine1: clean(input.addressLine1, 200),
      city: clean(input.city, 100),
      pincode,
      stateCode,
      language,
    },
  };
}
