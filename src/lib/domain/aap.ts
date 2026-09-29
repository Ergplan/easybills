/**
 * "Aap": everything about the owner's business, on one screen with one Save.
 *
 * The five first-day fields (lib/domain/profile.ts) plus what used to live on
 * a separate English settings page: the shop's address and PIN, the bank
 * account a bill prints, how bills are numbered, and how many days a customer
 * gets to pay. Checked here, in the browser as the owner types and again on
 * the server, so the message is the same both times. Pure.
 */
import { t } from '@/lib/copy';
import { checkLogo, parseLook, type BillLook } from '@/lib/domain/bill-look';
import { parseProfile, type ProfileField, type ProfileInput } from '@/lib/domain/profile';

export interface AapInput extends ProfileInput {
  addressLine1?: string | null;
  pincode?: string | null;
  email?: string | null;
  accountHolderName?: string | null;
  accountNumber?: string | null;
  ifsc?: string | null;
  bankName?: string | null;
  prefix: string;
  nextNumber: string | number;
  includeFinancialYear: boolean;
  paymentTermsDays: string | number;
  /** How bills look. Absent: left as it is. */
  look?: BillLook;
  /** The logo as a data URL; null removes it; absent leaves it as it is. */
  logoDataUrl?: string | null;
}

export type AapField =
  | ProfileField
  | 'addressLine1'
  | 'pincode'
  | 'email'
  | 'accountHolderName'
  | 'accountNumber'
  | 'ifsc'
  | 'bankName'
  | 'prefix'
  | 'nextNumber'
  | 'paymentTermsDays'
  | 'logoDataUrl';

export interface AapClean {
  name: string;
  phone: string;
  gstin: string | null;
  upiId: string | null;
  city: string | null;
  stateCode: string | null;
  registrationType: 'regular' | 'not-registered';
  eInvoicingNotApplicable: boolean;
  addressLine1: string | null;
  pincode: string | null;
  email: string | null;
  bank: { accountHolderName: string | null; accountNumber: string | null; ifsc: string | null; bankName: string | null };
  numbering: { prefix: string; nextNumber: number; includeFinancialYear: boolean };
  paymentTermsDays: number;
  look: BillLook | undefined;
  logoDataUrl: string | null | undefined;
}

export type AapCheck = { ok: true; value: AapClean } | { ok: false; field: AapField; message: string };

/** The choices offered for "Paise kitne din mein?". */
export const PAYMENT_TERMS = [0, 7, 15, 30] as const;

const clean = (v: string | null | undefined) => (v ?? '').trim();
const orNull = (v: string | null | undefined) => clean(v) || null;

export function parseAap(input: AapInput, ctx: { minNextNumber: number }): AapCheck {
  const profile = parseProfile(input);
  if (!profile.ok) return { ok: false, field: profile.field, message: profile.message };

  const addressLine1 = orNull(input.addressLine1);
  if (addressLine1 && addressLine1.length > 200) return { ok: false, field: 'addressLine1', message: t('error.tooLong', { n: 200 }) };

  const pincode = orNull(input.pincode)?.replace(/\s/g, '') ?? null;
  if (pincode && !/^[1-9]\d{5}$/.test(pincode)) return { ok: false, field: 'pincode', message: t('aap.error.pincode') };

  const email = orNull(input.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, field: 'email', message: t('aap.error.email') };

  const accountHolderName = orNull(input.accountHolderName);
  if (accountHolderName && accountHolderName.length > 120) return { ok: false, field: 'accountHolderName', message: t('error.tooLong', { n: 120 }) };
  const accountNumber = orNull(input.accountNumber)?.replace(/\s/g, '') ?? null;
  if (accountNumber && !/^\d{6,20}$/.test(accountNumber)) return { ok: false, field: 'accountNumber', message: t('aap.error.account') };
  const ifsc = orNull(input.ifsc)?.toUpperCase().replace(/\s/g, '') ?? null;
  if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return { ok: false, field: 'ifsc', message: t('aap.error.ifsc') };
  const bankName = orNull(input.bankName);
  if (bankName && bankName.length > 120) return { ok: false, field: 'bankName', message: t('error.tooLong', { n: 120 }) };

  const prefix = clean(input.prefix);
  if (!/^[A-Za-z0-9/-]{0,10}$/.test(prefix)) return { ok: false, field: 'prefix', message: t('num.error.prefix') };
  const nextNumber = Math.floor(Number(String(input.nextNumber).replace(/\D/g, '')));
  if (!Number.isFinite(nextNumber) || nextNumber < ctx.minNextNumber || nextNumber > 999_999) {
    return { ok: false, field: 'nextNumber', message: t('num.error.tooLow', { min: ctx.minNextNumber }) };
  }

  const paymentTermsDays = Number(input.paymentTermsDays);
  if (!(PAYMENT_TERMS as readonly number[]).includes(paymentTermsDays)) {
    return { ok: false, field: 'paymentTermsDays', message: t('error.required') };
  }

  let logoDataUrl: string | null | undefined;
  if (input.logoDataUrl !== undefined) {
    const logo = checkLogo(input.logoDataUrl);
    if (!logo.ok) return { ok: false, field: 'logoDataUrl', message: logo.message };
    logoDataUrl = logo.value;
  }

  const p = profile.profile;
  return {
    ok: true,
    value: {
      name: p.name,
      phone: p.phone,
      gstin: p.gstin,
      upiId: p.upiId,
      city: p.city,
      stateCode: p.stateCode,
      registrationType: p.registrationType,
      eInvoicingNotApplicable: p.eInvoicingNotApplicable,
      addressLine1,
      pincode,
      email,
      bank: { accountHolderName, accountNumber, ifsc, bankName },
      numbering: { prefix, nextNumber, includeFinancialYear: Boolean(input.includeFinancialYear) },
      paymentTermsDays,
      look: input.look ? parseLook(input.look) : undefined,
      logoDataUrl,
    },
  };
}
