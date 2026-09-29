import 'server-only';

import { todayIst } from '@/lib/dates';
import type { BusinessRecord, InvoiceLine, InvoiceRecord } from '@/lib/domain/types';
import { emptyParty } from '@/server/repos/invoices';
import { priceInvoice } from '@/server/services/invoice-calc';

/**
 * A made-up bill in the owner's own name, for "Namuna bill dekho": their
 * shop, logo and colour on two ordinary lines, priced by the real engine so
 * the GST is right. It is never stored, has no number, and is rendered with
 * SAMPLE across it.
 */
export function sampleInvoice(business: BusinessRecord): InvoiceRecord {
  const issueDate = todayIst();
  const line = (id: string, description: string, qty: number, rupees: number): InvoiceLine => ({
    id,
    description,
    quantityMilli: qty * 1000,
    unitPricePaise: rupees * 100,
    discountPaise: 0,
    taxRateBp: business.defaultTaxRateBp ?? 1800,
    taxRateChosen: true,
    cessRateBp: 0,
    priceIncludesTax: false,
    unit: null,
    hsnCode: null,
    savedItemId: null,
  });
  const lines = [line('s1', 'AMC visit', 1, 3500), line('s2', 'Ceiling fan fitting', 2, 450)];
  const placeOfSupply = business.stateCode;
  const priced = priceInvoice({ business, lines, placeOfSupplyStateCode: placeOfSupply, supplyFlags: [], issueDate });
  const customer = { ...emptyParty('Mehta Traders'), city: 'Pune', stateCode: placeOfSupply };
  const now = new Date().toISOString();
  const chargesGst = priced.totals.totalTaxPaise > 0;

  return {
    id: 'sample',
    kind: 'customer-invoice',
    status: 'issued',
    number: 'SAMPLE',
    numberSequence: null,
    financialYear: null,
    issueDate,
    dueDate: null,
    paymentTermsDays: null,
    billingPeriod: null,
    customer,
    placeOfSupplyStateCode: placeOfSupply,
    supplyFlags: [],
    lines: chargesGst ? lines : lines.map((l) => ({ ...l, taxRateBp: 0 })),
    notes: null,
    totals: priced.totals,
    paymentStatus: 'unpaid',
    amountPaidPaise: 0,
    creditAppliedPaise: 0,
    debitAppliedPaise: 0,
    settlementDeductionPaise: 0,
    balancePaise: priced.totals.grandTotalPaise,
    issued: {
      issuedAt: now,
      issuedByUid: 'sample',
      documentKind: chargesGst ? 'tax-invoice' : 'invoice-no-gst',
      documentTitle: chargesGst ? 'Tax Invoice' : 'Invoice',
      seller: {
        legalName: business.legalName,
        tradeName: business.tradeName,
        addressLine1: business.addressLine1,
        addressLine2: business.addressLine2,
        city: business.city,
        pincode: business.pincode,
        stateCode: business.stateCode,
        gstin: business.gstin,
        pan: business.pan,
        phone: business.phone,
        email: business.email,
        bank: business.bank,
        logoDataUrl: business.logoDataUrl,
        signatureDataUrl: business.signatureDataUrl,
        accentColour: business.accentColour,
      },
      customer,
      rulePackVersion: 'sample',
      supplyType: chargesGst ? 'intra-state' : 'no-gst',
      placeOfSupplyStateCode: placeOfSupply,
    },
    cancelledAt: null,
    cancelledReason: null,
    scheduleId: null,
    occurrenceKey: null,
    duplicatedFromInvoiceId: null,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    createdByUid: 'sample',
  };
}
