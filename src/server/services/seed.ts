import 'server-only';

import { addDays, monthPeriodOf, todayIst } from '@/lib/dates';
import { parseMoney, parseQuantity } from '@/lib/money';
import { gstinCheckDigit } from '@/lib/gst/gstin';
import type { BusinessRecord, InvoiceLine } from '@/lib/domain/types';
import { createBusiness, updateBusiness } from '@/server/repos/business';
import { createCustomer, customerToParty } from '@/server/repos/customers';
import { createItem } from '@/server/repos/items';
import { emptyParty, issueInvoice, newInvoiceId, saveDraft } from '@/server/repos/invoices';
import { recordPayment } from '@/server/repos/payments';
import { createSchedule } from '@/server/repos/schedules';

/**
 * Synthetic seed data.
 *
 * Every identity here is obviously fictitious. The GSTINs are STRUCTURALLY VALID
 * but generated from invented PAN-shaped strings using the published check-digit
 * rule, so they exercise validation without impersonating a real taxpayer -- and
 * so nobody is tempted to treat them as real registrations.
 */

/** Build a structurally valid but plainly fictitious GSTIN. */
function fictitiousGstin(stateCode: string, panLike: string, entity = '1'): string {
  const first14 = `${stateCode}${panLike}${entity}Z`;
  return `${first14}${gstinCheckDigit(first14)}`;
}

const line = (description: string, qty: string, price: string, rate = '0'): InvoiceLine => ({
  id: crypto.randomUUID(),
  description,
  quantityMilli: parseQuantity(qty),
  unitPricePaise: parseMoney(price),
  discountPaise: 0,
  taxRateBp: rate === '0' ? 0 : Math.round(Number(rate) * 100),
  // Demo data is complete data: every rate here was chosen on purpose.
  taxRateChosen: true,
  cessRateBp: 0,
  priceIncludesTax: false,
  unit: null,
  hsnCode: null,
  savedItemId: null,
});

export type DemoProfile = 'repair' | 'consultant' | 'home-food';

/**
 * Seed one demo business.
 *
 * Demo records are flagged `isDemo`, which the UI surfaces as a banner on every
 * screen, so sample data can never be mistaken for a real ledger.
 */
export async function seedDemoBusiness(args: {
  uid: string;
  email: string | null;
  displayName: string | null;
  profile?: DemoProfile;
}): Promise<BusinessRecord> {
  const profile = args.profile ?? 'repair';
  const today = todayIst();

  const specs = {
    repair: {
      legalName: 'Demo Appliance Repairs (sample)',
      stateCode: '27',
      registrationType: 'not-registered' as const,
      gstin: null as string | null,
    },
    consultant: {
      legalName: 'Demo Consulting Services (sample)',
      stateCode: '29',
      registrationType: 'regular' as const,
      gstin: fictitiousGstin('29', 'ZZZZZ9999Z'),
    },
    'home-food': {
      legalName: 'Demo Home Kitchen (sample)',
      stateCode: '33',
      registrationType: 'not-registered' as const,
      gstin: null as string | null,
    },
  }[profile];

  const business = await createBusiness({
    uid: args.uid,
    email: args.email,
    displayName: args.displayName,
    legalName: specs.legalName,
    isDemo: true,
  });

  const configured = await updateBusiness(business.id, args.uid, {
    stateCode: specs.stateCode,
    registrationType: specs.registrationType,
    gstin: specs.gstin,
    addressLine1: '12 Sample Street',
    city: 'Sampletown',
    pincode: '400001',
    phone: '+919999900001',
    numbering: { prefix: 'DEMO-', nextNumber: 1, padding: 3, includeFinancialYear: false },
    numberingConfirmed: true,
    eInvoicingSelfDeclaredNotApplicable: specs.registrationType === 'regular',
    defaultPaymentTermsDays: 7,
  });

  // --- customers ----------------------------------------------------------
  const sharma = await createCustomer(business.id, args.uid, {
    name: 'Sharma Electricals (sample)',
    phone: '+919999900002',
    email: null,
    addressLine1: '4 Example Road',
    addressLine2: null,
    city: 'Sampletown',
    pincode: '400002',
    stateCode: specs.stateCode,
    gstin: specs.registrationType === 'regular' ? fictitiousGstin(specs.stateCode, 'YYYYY8888Y') : null,
    pan: null,
    notes: null,
  });

  const ravi = await createCustomer(business.id, args.uid, {
    name: 'Ravi Kumar (sample)',
    phone: '+919999900003',
    email: null,
    addressLine1: null,
    addressLine2: null,
    city: 'Sampletown',
    pincode: null,
    stateCode: specs.stateCode,
    gstin: null,
    pan: null,
    notes: null,
  });

  // --- saved items --------------------------------------------------------
  await createItem(business.id, {
    description: 'Repair visit',
    unitPricePaise: parseMoney('800'),
    unit: 'visit',
    taxRateBp: null,
    hsnCode: null,
  });
  await createItem(business.id, {
    description: 'Monthly service',
    unitPricePaise: parseMoney('700'),
    unit: 'month',
    taxRateBp: null,
    hsnCode: null,
  });

  /**
   * The brief's worked example: two visits at 800 plus parts of 450.
   *
   * The subtotal is 2,050 BEFORE any tax. No GST rate is assumed for it -- this
   * demo business is unregistered, so no rate applies; a registered demo would
   * require the owner to state one.
   */
  const exampleDraft = await saveDraft({
    business: configured,
    uid: args.uid,
    invoiceId: newInvoiceId(),
    kind: 'customer-invoice',
    issueDate: addDays(today, -6),
    customer: customerToParty(sharma),
    placeOfSupplyStateCode: specs.registrationType === 'regular' ? specs.stateCode : null,
    supplyFlags: [],
    lines: [line('Repair visit', '2', '800'), line('Spare parts', '1', '450')],
    notes: null,
    baseRevision: 0,
  });
  const { invoice: exampleIssued } = await issueInvoice({
    business: configured,
    uid: args.uid,
    invoiceId: exampleDraft.id,
  });

  // A part payment, so "Money to collect" and "Part paid" have something real.
  await recordPayment({
    businessId: business.id,
    uid: args.uid,
    customerId: sharma.id,
    receivedOn: addDays(today, -2),
    amountPaise: parseMoney('1000'),
    method: 'upi',
    reference: 'SAMPLE-UPI-1',
    note: null,
    allocations: [{ invoiceId: exampleIssued.id, amountPaise: parseMoney('1000') }],
  });

  // A fully unpaid, overdue bill.
  const overdueDraft = await saveDraft({
    business: configured,
    uid: args.uid,
    invoiceId: newInvoiceId(),
    kind: 'customer-invoice',
    issueDate: addDays(today, -40),
    dueDate: addDays(today, -33),
    paymentTermsDays: 7,
    customer: customerToParty(ravi),
    placeOfSupplyStateCode: specs.registrationType === 'regular' ? specs.stateCode : null,
    supplyFlags: [],
    lines: [line('Monthly service', '1', '700')],
    notes: null,
    baseRevision: 0,
  });
  await issueInvoice({ business: configured, uid: args.uid, invoiceId: overdueDraft.id });

  // A walk-in quick bill, paid in cash.
  const walkIn = await saveDraft({
    business: configured,
    uid: args.uid,
    invoiceId: newInvoiceId(),
    kind: 'quick-bill',
    issueDate: addDays(today, -1),
    customer: emptyParty(),
    placeOfSupplyStateCode: specs.registrationType === 'regular' ? specs.stateCode : null,
    supplyFlags: [],
    lines: [line('Fan repair', '1', '350')],
    notes: null,
    baseRevision: 0,
  });
  const { invoice: walkInIssued } = await issueInvoice({ business: configured, uid: args.uid, invoiceId: walkIn.id });
  await recordPayment({
    businessId: business.id,
    uid: args.uid,
    customerId: null,
    receivedOn: addDays(today, -1),
    amountPaise: walkInIssued.totals.grandTotalPaise,
    method: 'cash',
    reference: null,
    note: null,
    allocations: [{ invoiceId: walkInIssued.id, amountPaise: walkInIssued.totals.grandTotalPaise }],
  });

  // A monthly schedule, so the Home review queue has something to show.
  await createSchedule({
    businessId: business.id,
    uid: args.uid,
    customerId: ravi.id,
    customerName: ravi.name,
    anchorDay: 1,
    startDate: addDays(today, -1),
    endDate: null,
    billingPeriodChoice: 'previous-month',
    template: {
      version: 1,
      customer: customerToParty(ravi),
      placeOfSupplyStateCode: specs.registrationType === 'regular' ? specs.stateCode : null,
      lines: [line('Monthly service', '1', '700')],
      notes: null,
      paymentTermsDays: 7,
      supplyFlags: [],
      effectiveFromPeriod: monthPeriodOf(today),
    },
  });

  return configured;
}
