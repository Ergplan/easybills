'use server';

import { revalidatePath } from 'next/cache';

import type { MonthPeriod } from '@/lib/dates';
import { checkGstin } from '@/lib/gst/gstin';
import type { FilingFrequency } from '@/lib/domain/types';
import type { ReturnForm, SupplierBillRecord } from '@/lib/gst-returns/types';
import { requireBusiness } from '@/server/auth/guard';
import { updateBusiness } from '@/server/repos/business';
import {
  approveForFiling,
  declareCompleteness,
  preparePeriod,
  type PreparedPeriod,
} from '@/server/gst/prepare';
import { resolveFinding, reviewItc } from '@/server/gst/repo';
import { importExternalSales, importGstr2b, importSupplierBills } from '@/server/gst/import-service';
import { attachOwnerFilingEvidence } from '@/server/gst/filing/submit';

import { ok, toActionError, type ActionResult } from './common';

/**
 * GST return setup.
 *
 * Filing frequency and QRMP status are STATED by the owner (or come from an
 * authorised portal read). They are never inferred from turnover, and nobody is
 * enrolled in anything automatically.
 */
export async function setupGstReturnsAction(
  businessId: string,
  input: {
    gstin: string;
    filingFrequency: FilingFrequency;
    usesIff: boolean;
    filingStartPeriod: MonthPeriod;
    previouslyFiledPeriods: MonthPeriod[];
  },
): Promise<ActionResult<null>> {
  try {
    const { business, user } = await requireBusiness(businessId);

    if (business.registrationType !== 'regular') {
      return {
        ok: false,
        error: 'GST returns are only for businesses registered under regular GST.',
      };
    }
    const check = checkGstin(input.gstin);
    if (!check.ok) return { ok: false, error: check.message ?? 'That GST number does not look right.' };
    if (business.gstin && business.gstin !== check.normalised) {
      return { ok: false, error: 'This GST number does not match the one in your business details.' };
    }

    await updateBusiness(businessId, user.uid, {
      gstReturns: {
        gstin: check.normalised,
        registrationType: 'regular',
        filingFrequency: input.filingFrequency,
        usesIff: input.usesIff,
        filingStartPeriod: input.filingStartPeriod,
        previouslyFiledPeriods: input.previouslyFiledPeriods,
        source: 'owner-declared',
        confirmedAt: new Date().toISOString(),
        confirmedByUid: user.uid,
      },
    });
    revalidatePath('/gst');
    return ok(null);
  } catch (error) {
    return toActionError(error);
  }
}

export async function preparePeriodAction(
  businessId: string,
  period: MonthPeriod,
): Promise<ActionResult<PreparedPeriod>> {
  try {
    const { business } = await requireBusiness(businessId);
    const prepared = await preparePeriod({ business, period });
    return ok(prepared);
  } catch (error) {
    return toActionError(error);
  }
}

export async function declareCompletenessAction(
  businessId: string,
  period: MonthPeriod,
  form: ReturnForm,
  answers: {
    allSalesIncluded: boolean;
    allPurchasesIncluded: boolean;
    otherLiabilitiesConsidered: boolean;
    confirmedNilIfEmpty: boolean;
  },
): Promise<ActionResult<null>> {
  try {
    const { business, user } = await requireBusiness(businessId);
    await declareCompleteness({ business, uid: user.uid, period, form, answers });
    revalidatePath('/gst');
    return ok(null);
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Import purchases from a CSV.
 *
 * The behaviour lives in the import service; this wrapper authorises the caller
 * and shapes the response for the UI.
 */
export async function importSupplierBillsAction(
  businessId: string,
  input: { filename: string; contents: string; period: MonthPeriod },
): Promise<ActionResult<{ imported: number; duplicates: number; rejected: number; errors: Array<{ row: number; message: string }>; alreadyImported: boolean }>> {
  try {
    const { user } = await requireBusiness(businessId);
    const result = await importSupplierBills({ businessId, uid: user.uid, ...input });
    revalidatePath('/gst');
    return ok({
      imported: result.imported,
      duplicates: result.duplicates,
      rejected: result.rejected,
      errors: result.errors,
      alreadyImported: result.alreadyImported,
    });
  } catch (error) {
    return toActionError(error);
  }
}

/** Import sales raised outside the app, keeping their original numbers. */
export async function importExternalSalesAction(
  businessId: string,
  input: { filename: string; contents: string; period: MonthPeriod },
): Promise<ActionResult<{ imported: number; duplicates: number; rejected: number; alreadyImported: boolean }>> {
  try {
    const { user } = await requireBusiness(businessId);
    const result = await importExternalSales({ businessId, uid: user.uid, ...input });
    revalidatePath('/gst');
    return ok(result);
  } catch (error) {
    return toActionError(error);
  }
}

/** Import a GSTR-2B statement, keeping its provenance. */
export async function importGstr2bAction(
  businessId: string,
  input: { filename: string; contents: string; period: MonthPeriod; generatedAt: string | null },
): Promise<ActionResult<{ rows: number; superseded: boolean }>> {
  try {
    const { business, user } = await requireBusiness(businessId);
    const result = await importGstr2b({ business, uid: user.uid, ...input });
    revalidatePath('/gst');
    return ok({ rows: result.rows, superseded: false });
  } catch (error) {
    return toActionError(error);
  }
}

/** Record a person's decision about credit on one purchase. */
export async function reviewItcAction(
  businessId: string,
  input: {
    billId: string;
    eligibility: SupplierBillRecord['itcEligibility'];
    eligibleCgstPaise: number;
    eligibleSgstPaise: number;
    eligibleIgstPaise: number;
    eligibleCessPaise: number;
    note: string | null;
  },
): Promise<ActionResult<null>> {
  try {
    const { user } = await requireBusiness(businessId);
    await reviewItc({ businessId, uid: user.uid, ...input });
    revalidatePath('/gst');
    return ok(null);
  } catch (error) {
    return toActionError(error);
  }
}

export async function resolveFindingAction(
  businessId: string,
  findingId: string,
  reason: string,
): Promise<ActionResult<null>> {
  try {
    const { user } = await requireBusiness(businessId);
    if (!reason.trim()) return { ok: false, error: 'Please say why you are leaving this as it is.' };
    await resolveFinding(businessId, findingId, user.uid, reason.trim());
    revalidatePath('/gst');
    return ok(null);
  } catch (error) {
    return toActionError(error);
  }
}

export async function approveForFilingAction(
  businessId: string,
  period: MonthPeriod,
  form: ReturnForm,
): Promise<ActionResult<{ versionId: string; payloadHash: string }>> {
  try {
    const { business, user } = await requireBusiness(businessId);
    const prepared = await preparePeriod({ business, period });
    const version = await approveForFiling({ business, uid: user.uid, form, prepared });
    revalidatePath('/gst');
    return ok({ versionId: version.id, payloadHash: version.payloadHash });
  } catch (error) {
    return toActionError(error);
  }
}

export async function attachFilingEvidenceAction(
  businessId: string,
  input: { period: MonthPeriod; form: ReturnForm; arn: string; note: string | null },
): Promise<ActionResult<null>> {
  try {
    const { business, user } = await requireBusiness(businessId);
    const gstin = business.gstReturns?.gstin;
    if (!gstin) return { ok: false, error: 'Please finish GST setup first.' };

    await attachOwnerFilingEvidence({
      businessId,
      uid: user.uid,
      gstin,
      form: input.form,
      period: input.period,
      arn: input.arn,
      attachmentName: null,
      attachmentHash: null,
      note: input.note,
    });
    revalidatePath('/gst');
    return ok(null);
  } catch (error) {
    return toActionError(error);
  }
}
