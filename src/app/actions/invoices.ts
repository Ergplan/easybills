'use server';

import { t } from '@/lib/copy';
import { billSentMessage, moneyForMessage } from '@/lib/copy/messages';

import { revalidatePath } from 'next/cache';

import { assertCivilDate, todayIst } from '@/lib/dates';
import { saveDraftInput, paymentInput } from '@/lib/domain/validation';
import type { InvoiceLine, InvoiceRecord } from '@/lib/domain/types';
import { formatMoneyPlain, formatPercentPlain, formatQuantityPlain, parseMoney } from '@/lib/money';
import { requireBusiness } from '@/server/auth/guard';
import { requireCurrentContext } from '@/server/auth/current';
import {
  cancelDraft,
  duplicateInvoice,
  emptyParty,
  getInvoice,
  issueInvoice,
  newInvoiceId,
  noteReminder,
  saveDraft,
} from '@/server/repos/invoices';
import { createCustomer, customerToParty, getCustomer, markBilled } from '@/server/repos/customers';
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

/**
 * "Bill banao": one tap from typing to a numbered bill.
 *
 * Saves the lines and the customer, creates the customer record if this is a
 * new name, then issues -- in that order, so the invoice snapshot carries the
 * customer and the customer carries the bill. The old flow was save, review,
 * issue as three screens; the review is the total the owner has been
 * watching while typing.
 */
export async function makeBillAction(
  businessId: string,
  raw: {
    invoiceId: string;
    baseRevision: number;
    issueDate: string;
    customer: { customerId: string | null; name: string; phone: string | null };
    lines: InvoiceLine[];
  },
): Promise<ActionResult<{ invoice: InvoiceRecord; message: string }>> {
  try {
    const { business, user } = await requireBusiness(businessId);
    const draft = await getInvoice(businessId, raw.invoiceId);
    if (!draft) return { ok: false, error: t('error.notFound'), code: 'not-found' };
    if (draft.status === 'issued') {
      return ok({ invoice: draft, message: sentMessage(business, draft) });
    }

    // Who the bill is for. A name with no id is a new customer: remembered
    // now, so the chip is there next time and the reminder knows who to greet.
    const name = raw.customer.name.trim() || t('bill.forWalkIn');
    let party = draft.customer;
    if (raw.customer.customerId && raw.customer.customerId === draft.customer.customerId) {
      party = { ...draft.customer, phone: raw.customer.phone ?? draft.customer.phone };
    } else if (raw.customer.customerId) {
      const existing = await getCustomer(businessId, raw.customer.customerId);
      if (!existing) return { ok: false, error: t('error.notFound'), code: 'not-found' };
      party = customerToParty(existing);
    } else if (raw.customer.name.trim()) {
      const created = await createCustomer(businessId, user.uid, {
        name,
        phone: phoneOrNull(raw.customer.phone),
        email: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        pincode: null,
        stateCode: null,
        gstin: null,
        pan: null,
        notes: null,
      });
      party = customerToParty(created);
    } else {
      party = emptyParty(name);
    }

    const issueDate = assertCivilDate(raw.issueDate, 'date');
    const saved = await saveDraft({
      business,
      uid: user.uid,
      invoiceId: raw.invoiceId,
      kind: draft.kind,
      issueDate,
      customer: party,
      placeOfSupplyStateCode: party.stateCode ?? business.stateCode,
      supplyFlags: [],
      lines: saveDraftInput.shape.lines.parse(
        raw.lines.map((l) => ({
          ...l,
          quantityMilli: formatQuantityPlain(l.quantityMilli),
          unitPricePaise: formatMoneyPlain(l.unitPricePaise),
          discountPaise: formatMoneyPlain(l.discountPaise),
          taxRateBp: l.taxRateChosen ? formatPercentPlain(l.taxRateBp) : '',
          cessRateBp: formatPercentPlain(l.cessRateBp),
        })),
      ),
      notes: draft.notes,
      baseRevision: raw.baseRevision,
    });

    const result = await issueInvoice({ business, uid: user.uid, invoiceId: raw.invoiceId, expectedRevision: saved.revision });
    if (result.invoice.customer.customerId) {
      await markBilled(businessId, result.invoice.customer.customerId).catch(() => undefined);
    }
    revalidatePath('/home');
    revalidatePath('/bills');
    return ok({ invoice: result.invoice, message: sentMessage(business, result.invoice) });
  } catch (error) {
    return toActionError(error);
  }
}

function sentMessage(business: { legalName: string; bank: { upiId: string | null } }, invoice: InvoiceRecord): string {
  return billSentMessage({
    customer: { name: invoice.customer.name },
    business: { name: business.legalName, upiId: business.bank.upiId },
    bill: { number: invoice.number ?? '', amountDuePaise: invoice.balancePaise, issueDate: invoice.issueDate },
  });
}

function phoneOrNull(raw: string | null): string | null {
  const digits = (raw ?? '').replace(/[\s\-()]/g, '');
  return digits ? digits : null;
}

/**
 * "Likh lo": the money came in. Amount, when, how -- and the errors in the
 * owner's words. A double tap records it once, by the key the form fixed
 * before its first try.
 */
export async function likhLoAction(
  businessId: string,
  raw: { invoiceId: string; amount: string; receivedOn: string; method: 'upi' | 'cash' | 'bank-transfer' | 'other'; idempotencyKey: string },
): Promise<ActionResult<{ balancePaise: number }>> {
  try {
    const { user } = await requireBusiness(businessId);
    const invoice = await getInvoice(businessId, raw.invoiceId);
    if (!invoice) return { ok: false, error: t('error.notFound'), code: 'not-found' };
    let amountPaise: number;
    try {
      amountPaise = parseMoney(raw.amount);
    } catch {
      return { ok: false, error: t('error.amount'), code: 'validation' };
    }
    if (amountPaise <= 0) return { ok: false, error: t('error.amount'), code: 'validation' };
    if (amountPaise > invoice.balancePaise) {
      return { ok: false, error: t('paid.tooMuch', { amount: moneyForMessage(invoice.balancePaise) }), code: 'validation' };
    }
    await recordPayment({
      businessId,
      uid: user.uid,
      customerId: invoice.customer.customerId,
      receivedOn: assertCivilDate(raw.receivedOn, 'date'),
      amountPaise,
      method: raw.method,
      reference: null,
      note: null,
      allocations: [{ invoiceId: invoice.id, amountPaise }],
      idempotencyKey: raw.idempotencyKey,
    });
    const after = await getInvoice(businessId, raw.invoiceId);
    revalidatePath('/home');
    revalidatePath('/bills');
    return ok({ balancePaise: after?.balancePaise ?? 0 });
  } catch (error) {
    return toActionError(error);
  }
}

/** The owner tapped through to WhatsApp with a reminder. */
export async function noteReminderAction(businessId: string, invoiceId: string): Promise<ActionResult<null>> {
  try {
    await requireBusiness(businessId);
    await noteReminder(businessId, invoiceId);
    revalidatePath('/home');
    return ok(null);
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
