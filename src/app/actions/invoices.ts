'use server';

import { t } from '@/lib/copy';

import { revalidatePath } from 'next/cache';

import { todayIst } from '@/lib/dates';
import { saveDraftInput, paymentInput } from '@/lib/domain/validation';
import type { InvoiceRecord } from '@/lib/domain/types';
import { requireBusiness } from '@/server/auth/guard';
import { requireCurrentContext } from '@/server/auth/current';
import {
  cancelDraft,
  duplicateInvoice,
  emptyParty,
  getInvoice,
  issueInvoice,
  newInvoiceId,
  saveDraft,
} from '@/server/repos/invoices';
import { customerToParty, getCustomer, markBilled } from '@/server/repos/customers';
import { createItem } from '@/server/repos/items';
import { recordPayment, recordSettlementDeduction, reversePayment } from '@/server/repos/payments';
import { createAdjustment } from '@/server/repos/adjustments';
import { priceInvoice } from '@/server/services/invoice-calc';

import { ok, toActionError, type ActionResult } from './common';

/**
 * Autosave a draft.
 *
 * The client sends what it has plus the revision it last saw. Amounts arrive as
 * strings and are parsed here; totals are recomputed from the parsed lines, so
 * nothing the client asserts about money is trusted.
 */
export async function saveDraftAction(
  businessId: string,
  raw: unknown,
): Promise<ActionResult<{ invoice: InvoiceRecord }>> {
  try {
    const { business, user } = await requireBusiness(businessId);
    const input = saveDraftInput.parse(raw);

    const invoice = await saveDraft({
      business,
      uid: user.uid,
      invoiceId: input.invoiceId,
      kind: input.kind,
      issueDate: input.issueDate,
      dueDate: input.dueDate ?? undefined,
      paymentTermsDays: input.paymentTermsDays ?? undefined,
      billingPeriod: input.billingPeriod ?? undefined,
      customer: input.customer,
      placeOfSupplyStateCode: input.placeOfSupplyStateCode,
      supplyFlags: input.supplyFlags,
      lines: input.lines.map((l) => ({
        id: l.id,
        description: l.description,
        quantityMilli: l.quantityMilli,
        unitPricePaise: l.unitPricePaise,
        discountPaise: l.discountPaise,
        taxRateBp: l.taxRateBp,
        taxRateChosen: l.taxRateChosen,
        cessRateBp: l.cessRateBp,
        priceIncludesTax: l.priceIncludesTax,
        unit: l.unit,
        hsnCode: l.hsnCode,
        savedItemId: l.savedItemId,
      })),
      notes: input.notes,
      baseRevision: input.baseRevision,
    });

    return ok({ invoice });
  } catch (error) {
    return toActionError(error);
  }
}

/** Price a draft without saving, for the live preview and review screen. */
export async function priceDraftAction(
  businessId: string,
  raw: unknown,
): Promise<ActionResult<ReturnType<typeof priceInvoice>>> {
  try {
    const { business } = await requireBusiness(businessId);
    const input = saveDraftInput.parse(raw);
    const priced = priceInvoice({
      business,
      lines: input.lines.map((l) => ({ ...l, savedItemId: l.savedItemId })),
      placeOfSupplyStateCode: input.placeOfSupplyStateCode,
      supplyFlags: input.supplyFlags,
      issueDate: input.issueDate,
    });
    return ok(priced);
  } catch (error) {
    return toActionError(error);
  }
}

/** The commit step. Deliberately separate from saving, and never automatic. */
export async function issueInvoiceAction(
  businessId: string,
  invoiceId: string,
  expectedRevision?: number,
): Promise<ActionResult<{ invoice: InvoiceRecord; alreadyIssued: boolean }>> {
  try {
    const { business, user } = await requireBusiness(businessId);
    const result = await issueInvoice({ business, uid: user.uid, invoiceId, expectedRevision });
    if (result.invoice.customer.customerId) {
      await markBilled(businessId, result.invoice.customer.customerId).catch(() => undefined);
    }
    revalidatePath('/home');
    revalidatePath('/bills');
    return ok(result);
  } catch (error) {
    return toActionError(error);
  }
}

export async function startDraftAction(kind: 'quick-bill' | 'customer-invoice'): Promise<ActionResult<{ invoiceId: string }>> {
  try {
    const { business, user } = await requireCurrentContext();
    const invoiceId = newInvoiceId();
    await saveDraft({
      business,
      uid: user.uid,
      invoiceId,
      kind,
      issueDate: todayIst(),
      customer: emptyParty(kind === 'quick-bill' ? 'Walk-in customer' : ''),
      placeOfSupplyStateCode: business.stateCode,
      supplyFlags: [],
      // A single empty line so the owner lands on something typeable.
      lines: [
        {
          id: crypto.randomUUID(),
          description: '',
          quantityMilli: 1000,
          unitPricePaise: 0,
          discountPaise: 0,
          taxRateBp: business.defaultTaxRateBp ?? 0,
          // Only a configured default counts as an answer. With none, the rate
          // select opens blank and issuing waits for the owner to fill it.
          taxRateChosen: business.defaultTaxRateBp !== null,
          cessRateBp: 0,
          priceIncludesTax: false,
          unit: null,
          hsnCode: null,
          savedItemId: null,
        },
      ],
      notes: null,
      baseRevision: 0,
    });
    return ok({ invoiceId });
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * A chip on Home: the customer's details are already on the bill when the
 * editor opens, and there is one empty line to type into. "Naya customer"
 * comes through here too with no id, and the editor asks who it is for.
 */
export async function startBillForCustomerAction(
  customerId: string | null,
): Promise<ActionResult<{ invoiceId: string }>> {
  try {
    const { business, user } = await requireCurrentContext();
    const customer = customerId ? await getCustomer(business.id, customerId) : null;
    if (customerId && !customer) return { ok: false, error: t('error.notFound'), code: 'not-found' };
    const invoiceId = newInvoiceId();
    await saveDraft({
      business,
      uid: user.uid,
      invoiceId,
      kind: 'customer-invoice',
      issueDate: todayIst(),
      customer: customer ? customerToParty(customer) : emptyParty(''),
      placeOfSupplyStateCode: customer?.stateCode ?? business.stateCode,
      supplyFlags: [],
      lines: [
        {
          id: crypto.randomUUID(),
          description: '',
          quantityMilli: 1000,
          unitPricePaise: 0,
          discountPaise: 0,
          taxRateBp: business.defaultTaxRateBp ?? 0,
          taxRateChosen: business.defaultTaxRateBp !== null,
          cessRateBp: 0,
          priceIncludesTax: false,
          unit: null,
          hsnCode: null,
          savedItemId: null,
        },
      ],
      notes: null,
      baseRevision: 0,
    });
    return ok({ invoiceId });
  } catch (error) {
    return toActionError(error);
  }
}

export async function duplicateInvoiceAction(
  businessId: string,
  sourceInvoiceId: string,
): Promise<ActionResult<{ invoiceId: string }>> {
  try {
    const { business, user } = await requireBusiness(businessId);
    const draft = await duplicateInvoice({ business, uid: user.uid, sourceInvoiceId });
    revalidatePath('/bills');
    return ok({ invoiceId: draft.id });
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteDraftAction(businessId: string, invoiceId: string): Promise<ActionResult<null>> {
  try {
    await requireBusiness(businessId);
    await cancelDraft(businessId, invoiceId);
    revalidatePath('/bills');
    return ok(null);
  } catch (error) {
    return toActionError(error);
  }
}

export async function saveItemForNextTimeAction(
  businessId: string,
  line: { description: string; unitPricePaise: number; unit: string | null; taxRateBp: number | null; hsnCode: string | null },
): Promise<ActionResult<{ itemId: string }>> {
  try {
    await requireBusiness(businessId);
    const item = await createItem(businessId, {
      description: line.description,
      unitPricePaise: line.unitPricePaise,
      unit: line.unit,
      taxRateBp: line.taxRateBp,
      hsnCode: line.hsnCode,
    });
    return ok({ itemId: item.id });
  } catch (error) {
    return toActionError(error);
  }
}

export async function recordPaymentAction(businessId: string, raw: unknown): Promise<ActionResult<{ paymentId: string }>> {
  try {
    const { user } = await requireBusiness(businessId);
    const input = paymentInput.parse(raw);
    const payment = await recordPayment({
      businessId,
      uid: user.uid,
      customerId: input.customerId,
      receivedOn: input.receivedOn,
      amountPaise: input.amountPaise,
      method: input.method,
      reference: input.reference,
      note: input.note,
      allocations: input.allocations,
      idempotencyKey: input.idempotencyKey ?? undefined,
    });
    revalidatePath('/home');
    revalidatePath('/bills');
    return ok({ paymentId: payment.id });
  } catch (error) {
    return toActionError(error);
  }
}

export async function reversePaymentAction(
  businessId: string,
  paymentId: string,
  reason: string,
): Promise<ActionResult<null>> {
  try {
    const { user } = await requireBusiness(businessId);
    if (!reason.trim()) return { ok: false, error: 'Please say why this payment is being reversed.' };
    await reversePayment({ businessId, uid: user.uid, paymentId, reason: reason.trim(), reversedOn: todayIst() });
    revalidatePath('/bills');
    return ok(null);
  } catch (error) {
    return toActionError(error);
  }
}

export async function recordDeductionAction(
  businessId: string,
  invoiceId: string,
  amountPaise: number,
  reason: string,
  idempotencyKey?: string,
): Promise<ActionResult<null>> {
  try {
    const { user } = await requireBusiness(businessId);
    await recordSettlementDeduction({
      businessId,
      uid: user.uid,
      invoiceId,
      amountPaise,
      reason: reason.trim() || 'Deduction recorded by owner',
      onDate: todayIst(),
      idempotencyKey,
    });
    revalidatePath('/bills');
    return ok(null);
  } catch (error) {
    return toActionError(error);
  }
}

export async function loadInvoiceAction(businessId: string, invoiceId: string): Promise<ActionResult<InvoiceRecord | null>> {
  try {
    await requireBusiness(businessId);
    return ok(await getInvoice(businessId, invoiceId));
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Raise a credit or debit note against an issued bill.
 *
 * Whether the note changes GST liability is a separate, explicit answer from
 * the owner — correcting a customer's balance and adjusting a tax return are
 * not the same act, and conflating them is how a wrong return gets filed.
 */
export async function createAdjustmentAction(
  businessId: string,
  input: {
    invoiceId: string;
    kind: 'credit-note' | 'debit-note';
    amountPaise: number;
    reason: string;
    affectsTaxLiability: boolean;
    tax?: { taxableValuePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; cessPaise: number };
    idempotencyKey?: string;
  },
): Promise<ActionResult<{ number: string }>> {
  try {
    const { business, user } = await requireBusiness(businessId);
    const adjustment = await createAdjustment({
      business,
      uid: user.uid,
      invoiceId: input.invoiceId,
      kind: input.kind,
      amountPaise: input.amountPaise,
      reason: input.reason,
      affectsTaxLiability: input.affectsTaxLiability,
      tax: input.tax,
      idempotencyKey: input.idempotencyKey,
    });
    revalidatePath(`/bills/${input.invoiceId}`);
    revalidatePath('/home');
    return ok({ number: adjustment.number! });
  } catch (error) {
    return toActionError(error);
  }
}
