/**
 * Core records. These shapes are shared by the server, the API layer and the UI.
 *
 * Conventions:
 *  - Money is an integer in PAISE and the field name ends in `Paise`.
 *  - Quantity is an integer in MILLI-UNITS and the field name ends in `Milli`.
 *  - Rates are integer BASIS POINTS and end in `Bp`.
 *  - Business dates are civil dates ("YYYY-MM-DD"), never timestamps.
 *  - Record timestamps are ISO-8601 instants and end in `At`.
 */

import type { CustomerLanguage } from '@/lib/copy';
import type { CivilDate, FinancialYear, MonthPeriod } from '@/lib/dates';
import type { GstRegistrationType, SupplyFlag } from '@/lib/gst/scenarios';


export type Iso = string;

// ---------------------------------------------------------------------------
// Identity and tenancy
// ---------------------------------------------------------------------------

export interface UserRecord {
  uid: string;
  /** E.164. The phone is the identity; email is only there for older accounts. */
  phone: string | null;
  email: string | null;
  displayName: string | null;
  /** Businesses this user can reach. Authorisation still re-checks membership. */
  businessIds: string[];
  createdAt: Iso;
  lastSeenAt: Iso;
}

export type MemberRole = 'owner';

export interface MemberRecord {
  uid: string;
  role: MemberRole;
  createdAt: Iso;
}

// ---------------------------------------------------------------------------
// Business
// ---------------------------------------------------------------------------

export interface BankDetails {
  accountHolderName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  bankName: string | null;
  upiId: string | null;
}

export interface NumberingSeries {
  /** e.g. "INV-" or "2026/". Validated against the invoice-number character rules. */
  prefix: string;
  /** Next number to allocate within the active financial year. */
  nextNumber: number;
  /** Zero-padded width, e.g. 3 -> "001". */
  padding: number;
  /** Whether the financial year is appended, e.g. "INV-2026-27-001". */
  includeFinancialYear: boolean;
}

export interface BusinessRecord {
  id: string;
  /** Legal/business name printed on documents. */
  legalName: string;
  /** Optional trading name, if different. */
  tradeName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pincode: string | null;
  /** GST state code, e.g. "27". Required before issuing a GST bill. */
  stateCode: string | null;
  phone: string | null;
  email: string | null;

  registrationType: GstRegistrationType;
  gstin: string | null;
  pan: string | null;
  /** Declared yearly sales, used only for the e-invoicing screen. */
  declaredAggregateTurnoverPaise: number | null;
  eInvoicingSelfDeclaredNotApplicable: boolean;

  bank: BankDetails;
  /** Data URLs, size-validated. Kept in the record so no public bucket is needed. */
  logoDataUrl: string | null;
  signatureDataUrl: string | null;
  accentColour: string | null;

  /** Active financial year for numbering. Explicit, never inferred silently. */
  activeFinancialYear: FinancialYear;
  numbering: NumberingSeries;
  /** True once the owner has confirmed numbering will not collide with prior records. */
  numberingConfirmed: boolean;
  /** Whether the owner already issues invoices elsewhere. */
  issuesInvoicesElsewhere: boolean | null;

  defaultPaymentTermsDays: number;
  defaultTaxRateBp: number | null;
  roundToNearestRupee: boolean;

  /** Demo businesses are visibly separated from real records everywhere. */
  isDemo: boolean;

  /** GST return configuration. Null until the owner completes GST setup. */
  gstReturns: GstReturnConfig | null;

  createdAt: Iso;
  updatedAt: Iso;
}

export type FilingFrequency = 'monthly' | 'quarterly-qrmp';

export interface GstReturnConfig {
  gstin: string;
  registrationType: 'regular';
  filingFrequency: FilingFrequency;
  /** For QRMP, whether the owner uses the optional Invoice Furnishing Facility. */
  usesIff: boolean;
  /** First period this app is responsible for. Earlier periods are out of scope. */
  filingStartPeriod: MonthPeriod;
  /** Periods the owner says were already filed elsewhere. */
  previouslyFiledPeriods: MonthPeriod[];
  /** Where the above came from: the owner, or an authorised portal/provider read. */
  source: 'owner-declared' | 'provider-sync';
  confirmedAt: Iso;
  confirmedByUid: string;
}

// ---------------------------------------------------------------------------
// Customers and saved items
// ---------------------------------------------------------------------------

export interface CustomerRecord {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pincode: string | null;
  stateCode: string | null;
  gstin: string | null;
  pan: string | null;
  notes: string | null;
  /**
   * The person the owner talks to, when the customer is a shop or a company.
   * It is who a message greets: "Patil ji", not "Green Park Society ji".
   */
  contactPerson: string | null;
  /**
   * The language this customer should be messaged in. Null means the owner's
   * own (Hinglish). The app works in one language; its customers do not all
   * speak it, and a reminder in the wrong one reads as a form letter.
   */
  language: CustomerLanguage | null;
  /**
   * Where that language came from: the owner chose it, or a model suggested it
   * from the name and the city and the owner has not yet said otherwise. A
   * suggestion is shown as one, and is never silently promoted to a fact.
   */
  languageSource: 'owner' | 'suggested' | null;
  archived: boolean;
  createdAt: Iso;
  updatedAt: Iso;
  /** Denormalised for "recent customers first". Not authoritative for totals. */
  lastBilledAt: Iso | null;
}

export interface SavedItemRecord {
  id: string;
  description: string;
  unitPricePaise: number;
  unit: string | null;
  taxRateBp: number | null;
  hsnCode: string | null;
  archived: boolean;
  createdAt: Iso;
  updatedAt: Iso;
  lastUsedAt: Iso | null;
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export type InvoiceStatus = 'draft' | 'issued' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'partly-paid' | 'paid';
export type InvoiceKind = 'quick-bill' | 'customer-invoice';

export interface InvoiceLine {
  id: string;
  description: string;
  quantityMilli: number;
  unitPricePaise: number;
  discountPaise: number;
  taxRateBp: number;
  /**
   * Whether the owner actually picked a rate.
   *
   * 0% is a real, legal choice (nil-rated supply), so a zero rate cannot be
   * read as "not answered". This carries the difference from the editor to
   * the issuance check, which refuses to print a tax invoice claiming 0% GST
   * that nobody chose.
   */
  taxRateChosen: boolean;
  cessRateBp: number;
  priceIncludesTax: boolean;
  unit: string | null;
  hsnCode: string | null;
  /** Set when the line came from the catalogue, for "reuse is visible". */
  savedItemId: string | null;
}

/** Customer details as printed. For walk-ins most fields are null. */
export interface InvoiceParty {
  customerId: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pincode: string | null;
  stateCode: string | null;
  gstin: string | null;
  pan: string | null;
}

/**
 * Everything the document asserted at the moment it was issued.
 *
 * This snapshot is the reason a profile edit cannot rewrite history: the PDF and
 * every downstream return table read from here, not from the live business or
 * customer record.
 */
export interface IssuedSnapshot {
  issuedAt: Iso;
  issuedByUid: string;
  documentKind: 'tax-invoice' | 'invoice-no-gst';
  documentTitle: string;
  seller: {
    legalName: string;
    tradeName: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    pincode: string | null;
    stateCode: string | null;
    gstin: string | null;
    pan: string | null;
    phone: string | null;
    email: string | null;
    bank: BankDetails;
    logoDataUrl: string | null;
    signatureDataUrl: string | null;
    accentColour: string | null;
  };
  customer: InvoiceParty;
  /** The rule pack version the assessment was made under. */
  rulePackVersion: string;
  /** Recorded so a later correction can explain what was believed at the time. */
  supplyType: 'intra-state' | 'inter-state' | 'no-gst';
  placeOfSupplyStateCode: string | null;
}

export interface InvoiceTotals {
  subtotalPaise: number;
  totalDiscountPaise: number;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  totalTaxPaise: number;
  totalBeforeRoundingPaise: number;
  roundOffPaise: number;
  grandTotalPaise: number;
}

export interface InvoiceRecord {
  id: string;
  kind: InvoiceKind;
  status: InvoiceStatus;

  /** Null until issued. Allocated transactionally. */
  number: string | null;
  numberSequence: number | null;
  financialYear: FinancialYear | null;

  issueDate: CivilDate;
  dueDate: CivilDate | null;
  paymentTermsDays: number | null;

  /** The supply/billing period, kept separate from the issue date. */
  billingPeriod: { from: CivilDate; to: CivilDate } | null;

  customer: InvoiceParty;
  placeOfSupplyStateCode: string | null;
  supplyFlags: SupplyFlag[];

  lines: InvoiceLine[];
  notes: string | null;
  totals: InvoiceTotals;

  paymentStatus: PaymentStatus;
  /** Sum of allocations. Maintained transactionally with payments. */
  amountPaidPaise: number;
  /** Adjustments and settlement deductions allocated to this invoice. */
  creditAppliedPaise: number;
  debitAppliedPaise: number;
  settlementDeductionPaise: number;
  balancePaise: number;

  issued: IssuedSnapshot | null;
  cancelledAt: Iso | null;
  cancelledReason: string | null;

  /** Recurrence provenance. */
  scheduleId: string | null;
  occurrenceKey: string | null;
  /** Set when this draft came from Duplicate. */
  duplicatedFromInvoiceId: string | null;

  /**
   * How many times the owner has opened WhatsApp to remind about this bill,
   * and when last. Counted when they tap through, since the app cannot see
   * whether the message was sent. Optional: older documents predate it.
   */
  remindersSent?: number;
  lastRemindedAt?: Iso | null;

  /** Optimistic concurrency for autosave. Incremented on every server write. */
  revision: number;
  createdAt: Iso;
  updatedAt: Iso;
  createdByUid: string;
}

// ---------------------------------------------------------------------------
// Payments and adjustments
// ---------------------------------------------------------------------------

export type PaymentMethod = 'cash' | 'upi' | 'bank-transfer' | 'cheque' | 'card' | 'other';

export interface PaymentAllocation {
  invoiceId: string;
  amountPaise: number;
}

export interface PaymentRecord {
  id: string;
  customerId: string | null;
  receivedOn: CivilDate;
  amountPaise: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  allocations: PaymentAllocation[];
  /** Money received but not yet applied to any invoice. Never silently dropped. */
  unappliedPaise: number;
  /** Reversals keep the original row and add a reversing row. */
  reversedByPaymentId: string | null;
  reversalOfPaymentId: string | null;
  createdAt: Iso;
  createdByUid: string;
}

export type AdjustmentKind = 'credit-note' | 'debit-note' | 'settlement-deduction';

export interface AdjustmentRecord {
  id: string;
  kind: AdjustmentKind;
  /** Null until issued for credit/debit notes. */
  number: string | null;
  financialYear: FinancialYear | null;
  invoiceId: string;
  customerId: string | null;
  issueDate: CivilDate;
  reason: string;
  /** For a settlement deduction (e.g. owner-confirmed TDS) this is NOT cash received. */
  amountPaise: number;
  /** Tax breakdown, only meaningful for credit/debit notes. */
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  /**
   * Whether this adjustment is claimed to change GST liability, as opposed to
   * only correcting the customer's balance. The two are not the same thing.
   */
  affectsTaxLiability: boolean;
  status: 'draft' | 'issued';
  issuedAt: Iso | null;
  createdAt: Iso;
  createdByUid: string;
}

// ---------------------------------------------------------------------------
// Recurrence
// ---------------------------------------------------------------------------

export type ScheduleStatus = 'active' | 'paused' | 'stopped' | 'completed';
export type BillingPeriodChoice = 'current-month' | 'previous-month';

export interface RecurringTemplate {
  /** Version bumped on every "this and future" edit, so drafts record their source. */
  version: number;
  customer: InvoiceParty;
  placeOfSupplyStateCode: string | null;
  lines: InvoiceLine[];
  notes: string | null;
  paymentTermsDays: number;
  supplyFlags: SupplyFlag[];
  effectiveFromPeriod: MonthPeriod;
}

export interface RecurringScheduleRecord {
  id: string;
  status: ScheduleStatus;
  customerId: string | null;
  customerName: string;
  /** Day of month the owner chose; preserved so the 31st rule works. */
  anchorDay: number;
  nextDraftDate: CivilDate | null;
  endDate: CivilDate | null;
  billingPeriodChoice: BillingPeriodChoice;
  template: RecurringTemplate;
  /** Superseded template versions, kept so issued drafts stay explainable. */
  templateHistory: RecurringTemplate[];
  /** Periods the owner deliberately skipped; never recreated on resume. */
  skippedPeriods: MonthPeriod[];
  pausedAt: Iso | null;
  stoppedAt: Iso | null;
  lastRunAt: Iso | null;
  createdAt: Iso;
  updatedAt: Iso;
  createdByUid: string;
}

export type OccurrenceStatus = 'draft-created' | 'skipped' | 'failed';

export interface RecurringOccurrenceRecord {
  /** `${scheduleId}__${period}` -- the stable unique key. */
  id: string;
  scheduleId: string;
  period: MonthPeriod;
  status: OccurrenceStatus;
  invoiceId: string | null;
  templateVersion: number;
  scheduledFor: CivilDate;
  createdAt: Iso;
  /** True when produced by catch-up rather than on time. */
  wasCatchUp: boolean;
  failureReason: string | null;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEventRecord {
  id: string;
  at: Iso;
  actorUid: string | null;
  /** "system" for worker-originated events. */
  actorKind: 'user' | 'system';
  action: string;
  subjectType: string;
  subjectId: string;
  /** Small, non-sensitive detail. Never bank details or full payloads. */
  detail: Record<string, unknown> | null;
}
