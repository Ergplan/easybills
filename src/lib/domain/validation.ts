/**
 * Input validation.
 *
 * Everything the client sends is untrusted, including values the client itself
 * computed. Amounts arrive as strings and are parsed here into integer minor
 * units; totals sent by the client are IGNORED and recomputed server-side.
 */

import { z } from 'zod';

import { isCivilDate, isMonthPeriod } from '@/lib/dates';
import { parseMoney, parsePercent, parseQuantity } from '@/lib/money';
import { checkGstin, checkPan } from '@/lib/gst/gstin';
import { findState } from '@/lib/gst/state-codes';

export const civilDate = z.string().refine(isCivilDate, 'Enter a valid date');
export const monthPeriod = z.string().refine(isMonthPeriod, 'Enter a valid month');

const trimmedOrNull = (max: number) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => {
      const s = typeof v === 'string' ? v.trim() : '';
      return s === '' ? null : s;
    })
    .refine((v) => v === null || v.length <= max, `Please keep this under ${max} characters`);

export const moneyString = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    try {
      return parseMoney(v);
    } catch (e) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid amount' });
      return z.NEVER;
    }
  });

export const optionalMoneyString = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === '') return 0;
    try {
      return parseMoney(v);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid amount' });
      return z.NEVER;
    }
  });

export const quantityString = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    try {
      const q = parseQuantity(v);
      if (q <= 0) {
        ctx.addIssue({ code: 'custom', message: 'Quantity must be more than zero' });
        return z.NEVER;
      }
      return q;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid quantity' });
      return z.NEVER;
    }
  });

export const percentString = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === '') return 0;
    try {
      const bp = parsePercent(v);
      if (bp < 0 || bp > 10_000) {
        ctx.addIssue({ code: 'custom', message: 'Enter a rate between 0 and 100' });
        return z.NEVER;
      }
      return bp;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid rate' });
      return z.NEVER;
    }
  });

export const stateCode = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === 'string' && v.trim() ? v.trim() : null))
  .refine((v) => v === null || findState(v) !== null, 'Choose a valid state');

export const gstinField = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : null))
  .refine((v) => v === null || checkGstin(v).ok, 'This does not look like a valid GST number');

export const panField = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : null))
  .refine((v) => v === null || checkPan(v).ok, 'A PAN looks like ABCDE1234F');

export const phoneField = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === 'string' && v.trim() ? v.replace(/[\s-]/g, '') : null))
  .refine((v) => v === null || /^(\+91)?[6-9]\d{9}$/.test(v) || /^\+\d{6,15}$/.test(v), 'Enter a valid phone number');

export const emailField = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null))
  .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address');

export const supplyFlag = z.enum([
  'export',
  'sez',
  'deemed-export',
  'reverse-charge',
  'advance-receipt',
  'exempt-or-nil-rated',
  'non-gst-supply',
]);

const invoiceLineFields = z.object({
  id: z.string().min(1).max(64),
  description: z.string().trim().min(1, 'Add a description').max(300),
  quantityMilli: quantityString,
  unitPricePaise: moneyString,
  discountPaise: optionalMoneyString,
  taxRateBp: percentString,
  /**
   * Derived below from the raw rate field, never taken from the client as a
   * separate claim -- so it cannot drift from the rate it describes.
   */
  taxRateChosen: z.boolean().default(true),
  cessRateBp: percentString,
  priceIncludesTax: z.boolean().default(false),
  unit: trimmedOrNull(20),
  hsnCode: trimmedOrNull(10),
  savedItemId: trimmedOrNull(64),
});

/**
 * An empty rate field means the owner has not answered yet. `percentString`
 * turns it into 0, which is indistinguishable from a deliberate nil-rated 0%,
 * so the distinction is captured here before it is lost.
 */
export const invoiceLineInput = z.preprocess((v) => {
  if (v === null || typeof v !== 'object') return v;
  const raw = (v as Record<string, unknown>).taxRateBp;
  const unanswered = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
  return { ...(v as Record<string, unknown>), taxRateChosen: !unanswered };
}, invoiceLineFields);

export const invoicePartyInput = z.object({
  customerId: trimmedOrNull(64),
  name: z.string().trim().min(1, 'Add a customer name').max(200),
  phone: phoneField,
  email: emailField,
  addressLine1: trimmedOrNull(200),
  addressLine2: trimmedOrNull(200),
  city: trimmedOrNull(100),
  pincode: trimmedOrNull(10),
  stateCode,
  gstin: gstinField,
  pan: panField,
});

export const saveDraftInput = z.object({
  invoiceId: z.string().min(1).max(64),
  kind: z.enum(['quick-bill', 'customer-invoice']),
  issueDate: civilDate,
  dueDate: z.union([civilDate, z.null()]).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
  billingPeriod: z
    .object({ from: civilDate, to: civilDate })
    .nullable()
    .optional(),
  customer: invoicePartyInput,
  placeOfSupplyStateCode: stateCode,
  supplyFlags: z.array(supplyFlag).max(7).default([]),
  // Deliberately allows zero lines: a draft may be incomplete. Issuance
  // requires at least one line, and enforces it inside the issue transaction.
  lines: z.array(invoiceLineInput).max(200),
  notes: trimmedOrNull(2000),
  /** The revision the client last saw. Rejects a stale overwrite. */
  baseRevision: z.number().int().min(0),
});

export type SaveDraftInput = z.infer<typeof saveDraftInput>;

export const customerInput = z.object({
  name: z.string().trim().min(1, 'Add a name').max(200),
  phone: phoneField,
  email: emailField,
  addressLine1: trimmedOrNull(200),
  addressLine2: trimmedOrNull(200),
  city: trimmedOrNull(100),
  pincode: trimmedOrNull(10),
  stateCode,
  gstin: gstinField,
  pan: panField,
  notes: trimmedOrNull(1000),
  /** The person the owner talks to at a shop. Who a message says "ji" to. */
  contactPerson: trimmedOrNull(100).optional(),
  /** The language this customer is messaged in. Null is the owner's own. */
  language: z.enum(['hi', 'mr', 'gu', 'ta', 'te', 'kn', 'bn', 'en']).nullable().optional(),
  languageSource: z.enum(['owner', 'suggested']).nullable().optional(),
});

export const savedItemInput = z.object({
  description: z.string().trim().min(1, 'Add a description').max(300),
  unitPricePaise: moneyString,
  unit: trimmedOrNull(20),
  taxRateBp: percentString.nullable().optional(),
  hsnCode: trimmedOrNull(10),
});

export const paymentInput = z.object({
  customerId: trimmedOrNull(64),
  receivedOn: civilDate,
  amountPaise: moneyString,
  method: z.enum(['cash', 'upi', 'bank-transfer', 'cheque', 'card', 'other']),
  reference: trimmedOrNull(120),
  note: trimmedOrNull(500),
  allocations: z
    .array(z.object({ invoiceId: z.string().min(1).max(64), amountPaise: moneyString }))
    .max(50)
    .default([]),
  /**
   * Fixed by the form before its first submit, so a double tap or a retry
   * records one payment. Optional, because a caller that has not adopted it
   * should still be able to record a payment.
   */
  idempotencyKey: trimmedOrNull(128),
});

/** Numbering prefix: kept to characters that are safe in a document number. */
export const numberingInput = z.object({
  prefix: z
    .string()
    .trim()
    .max(10, 'Keep the prefix short')
    .regex(/^[A-Za-z0-9/\-]*$/, 'Use only letters, numbers, - and /'),
  nextNumber: z.number().int().min(1).max(999_999),
  padding: z.number().int().min(0).max(8),
  includeFinancialYear: z.boolean(),
});
