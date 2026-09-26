'use server';

import { revalidatePath } from 'next/cache';

import { financialYearOf, todayIst } from '@/lib/dates';
import { parseProfile, type ProfileField, type ProfileInput } from '@/lib/domain/profile';
import { numberingInput } from '@/lib/domain/validation';
import { checkGstin, checkPan } from '@/lib/gst/gstin';
import { stateName } from '@/lib/gst/state-codes';
import { parseMoney } from '@/lib/money';
import type { BusinessRecord } from '@/lib/domain/types';
import { requireBusiness } from '@/server/auth/guard';
import { requireUser } from '@/server/auth/session';
import { createBusiness, updateBusiness } from '@/server/repos/business';

import { ok, toActionError, type ActionResult } from './common';

/**
 * The first screen: "Apne baare mein batayen". Five fields, checked by
 * `parseProfile` in the browser as the owner types and again here, and then a
 * business exists and the owner is on Home.
 *
 * The phone is the one they signed in with. It is accepted from the form so the
 * checks are the same everywhere, but the session's number wins when there is
 * one, because that is the number an OTP actually reached.
 */
export async function createBusinessAction(
  input: ProfileInput,
): Promise<ActionResult<{ businessId: string }> | { ok: false; error: string; field: ProfileField }> {
  try {
    const user = await requireUser();
    const checked = parseProfile({ ...input, phone: user.phone ?? input.phone });
    if (!checked.ok) return { ok: false, error: checked.message, field: checked.field };
    const { profile } = checked;
    const business = await createBusiness({
      uid: user.uid,
      phone: profile.phone,
      email: user.email,
      displayName: user.name ?? profile.name,
      legalName: profile.name,
      profile: {
        phone: profile.phone,
        gstin: profile.gstin,
        upiId: profile.upiId,
        city: profile.city,
        stateCode: profile.stateCode,
        registrationType: profile.registrationType,
      },
    });
    return ok({ businessId: business.id });
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * "Aap": the same five fields, edited later.
 *
 * Changing the UPI ID changes where customers send money. The older settings
 * screen gates that on re-typing a password; there is no password any more,
 * and the owner reached this screen through an OTP on the phone in their
 * hand. That is the check. It is also the case that the deployed app has no
 * sign-in at all today (AUTH_BYPASS), which no gate here can make up for.
 */
export async function saveProfileAction(
  businessId: string,
  input: ProfileInput,
): Promise<ActionResult<BusinessRecord> | { ok: false; error: string; field: ProfileField }> {
  try {
    const { user, business } = await requireBusiness(businessId);
    const checked = parseProfile({ ...input, phone: user.phone ?? input.phone });
    if (!checked.ok) return { ok: false, error: checked.message, field: checked.field };
    const { profile } = checked;
    const updated = await updateBusiness(businessId, user.uid, {
      legalName: profile.name,
      phone: profile.phone,
      gstin: profile.gstin,
      // A GST number settles the status; taking it away un-settles it back to
      // "not registered", never to "not sure".
      registrationType: profile.registrationType,
      stateCode: profile.stateCode,
      city: profile.city,
      bank: { ...business.bank, upiId: profile.upiId },
    });
    revalidatePath('/home');
    revalidatePath('/you');
    revalidatePath('/settings');
    return ok(updated);
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Update the business profile.
 *
 * Changing where money is sent is a security-sensitive action, so bank and UPI
 * details require a recent sign-in: `requireRecentAuth` refuses a session that
 * has been idle, forcing the owner to prove who they are before a payee changes.
 */
export async function updateBusinessAction(
  businessId: string,
  patch: Record<string, unknown>,
): Promise<ActionResult<BusinessRecord>> {
  try {
    const { user, business } = await requireBusiness(businessId);
    const clean: Partial<BusinessRecord> = {};

    const str = (key: string, max = 200) => {
      if (!(key in patch)) return undefined;
      const v = patch[key];
      if (v === null || v === undefined || v === '') return null;
      const s = String(v).trim();
      if (s.length > max) throw new Error(`Please keep ${key} under ${max} characters.`);
      return s;
    };

    for (const key of ['legalName', 'tradeName', 'addressLine1', 'addressLine2', 'city', 'pincode', 'phone', 'email'] as const) {
      const v = str(key);
      if (v !== undefined) (clean as Record<string, unknown>)[key] = v;
    }

    if ('stateCode' in patch) clean.stateCode = patch.stateCode ? String(patch.stateCode) : null;

    if ('registrationType' in patch) {
      const t = String(patch.registrationType);
      if (!['not-registered', 'regular', 'composition', 'not-sure'].includes(t)) {
        return { ok: false, error: 'Please choose a valid GST status.' };
      }
      clean.registrationType = t as BusinessRecord['registrationType'];
    }

    if ('gstin' in patch) {
      const raw = patch.gstin ? String(patch.gstin).trim().toUpperCase() : '';
      if (!raw) {
        clean.gstin = null;
      } else {
        const check = checkGstin(raw);
        if (!check.ok) return { ok: false, error: check.message ?? 'That GST number does not look right.' };
        clean.gstin = check.normalised;
        // A GSTIN carries its own state code. If the owner also picked a state
        // and the two disagree, say so rather than silently preferring one --
        // a wrong state here produces the wrong tax on every future bill.
        const chosenState = clean.stateCode ?? business.stateCode;
        if (chosenState && chosenState !== check.stateCode) {
          return {
            ok: false,
            error:
              `Your GST number belongs to ${check.stateName}, but your business state is set to ` +
              `${stateName(chosenState)}. Please correct whichever one is wrong.`,
          };
        }
        clean.stateCode = check.stateCode!;
      }
    }

    if ('pan' in patch) {
      const raw = patch.pan ? String(patch.pan).trim().toUpperCase() : '';
      if (!raw) clean.pan = null;
      else {
        const check = checkPan(raw);
        if (!check.ok) return { ok: false, error: check.message ?? 'That PAN does not look right.' };
        clean.pan = check.normalised;
      }
    }

    if ('declaredAggregateTurnover' in patch) {
      const raw = patch.declaredAggregateTurnover;
      clean.declaredAggregateTurnoverPaise = raw === null || raw === '' ? null : parseMoney(String(raw), 'yearly sales');
    }

    if ('eInvoicingSelfDeclaredNotApplicable' in patch) {
      clean.eInvoicingSelfDeclaredNotApplicable = Boolean(patch.eInvoicingSelfDeclaredNotApplicable);
    }

    if ('issuesInvoicesElsewhere' in patch) {
      clean.issuesInvoicesElsewhere =
        patch.issuesInvoicesElsewhere === null ? null : Boolean(patch.issuesInvoicesElsewhere);
    }

    if ('numbering' in patch) {
      const numbering = numberingInput.parse(patch.numbering);
      // Moving the sequence backwards could re-use an issued number.
      if (numbering.nextNumber < business.numbering.nextNumber && business.numbering.nextNumber > 1) {
        return {
          ok: false,
          error: 'The starting number cannot go backwards, because a bill has already used it.',
        };
      }
      clean.numbering = numbering;
      clean.numberingConfirmed = true;
    }

    if ('roundToNearestRupee' in patch) clean.roundToNearestRupee = Boolean(patch.roundToNearestRupee);
    if ('defaultPaymentTermsDays' in patch) {
      const days = Number(patch.defaultPaymentTermsDays);
      if (!Number.isInteger(days) || days < 0 || days > 365) {
        return { ok: false, error: 'Payment terms must be between 0 and 365 days.' };
      }
      clean.defaultPaymentTermsDays = days;
    }
    if ('accentColour' in patch) {
      const raw = patch.accentColour ? String(patch.accentColour) : '';
      if (raw && !/^#[0-9a-fA-F]{6}$/.test(raw)) return { ok: false, error: 'Please choose a valid colour.' };
      clean.accentColour = raw || null;
    }
    if ('activeFinancialYear' in patch) {
      const fy = String(patch.activeFinancialYear);
      if (!/^\d{4}-\d{2}$/.test(fy)) return { ok: false, error: 'Please choose a valid financial year.' };
      clean.activeFinancialYear = fy;
    }

    const updated = await updateBusiness(businessId, user.uid, clean);
    revalidatePath('/settings');
    revalidatePath('/home');
    return ok(updated);
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Bank and UPI details decide where a customer sends money, so a change here is
 * gated on a recent sign-in rather than merely a valid session.
 */
export async function updateBankDetailsAction(
  businessId: string,
  bank: Record<string, unknown>,
  confirmation: { reauthenticatedAt: number },
): Promise<ActionResult<BusinessRecord>> {
  try {
    const { user } = await requireBusiness(businessId);

    const ageMs = Date.now() - Number(confirmation?.reauthenticatedAt ?? 0);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 5 * 60 * 1000) {
      return {
        ok: false,
        code: 'reauth-required',
        error: 'For your security, please confirm your password before changing payment details.',
      };
    }

    const val = (k: string, max: number) => {
      const v = bank[k];
      if (v === null || v === undefined || v === '') return null;
      const s = String(v).trim();
      return s.length > max ? s.slice(0, max) : s;
    };

    const ifsc = val('ifsc', 11);
    if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase())) {
      return { ok: false, error: 'That IFSC code does not look right.' };
    }
    const accountNumber = val('accountNumber', 20);
    if (accountNumber && !/^\d{6,20}$/.test(accountNumber)) {
      return { ok: false, error: 'An account number should be 6 to 20 digits.' };
    }
    const upiId = val('upiId', 100);
    if (upiId && !/^[\w.\-]{2,60}@[a-zA-Z]{2,30}$/.test(upiId)) {
      return { ok: false, error: 'That UPI ID does not look right.' };
    }

    const updated = await updateBusiness(businessId, user.uid, {
      bank: {
        accountHolderName: val('accountHolderName', 120),
        accountNumber,
        ifsc: ifsc ? ifsc.toUpperCase() : null,
        bankName: val('bankName', 120),
        upiId,
      },
    });
    revalidatePath('/settings');
    return ok(updated);
  } catch (error) {
    return toActionError(error);
  }
}

export async function rolloverFinancialYearAction(businessId: string): Promise<ActionResult<BusinessRecord>> {
  try {
    const { user } = await requireBusiness(businessId);
    const fy = financialYearOf(todayIst());
    const updated = await updateBusiness(businessId, user.uid, {
      activeFinancialYear: fy,
      numbering: { prefix: '', nextNumber: 1, padding: 3, includeFinancialYear: true },
    });
    return ok(updated);
  } catch (error) {
    return toActionError(error);
  }
}
