import 'server-only';

import { addDays, type CivilDate } from '@/lib/dates';
import { computeTax, type TaxComputation } from '@/lib/gst/tax-engine';
import { assessIssuance, type IssuanceAssessment } from '@/lib/gst/scenarios';
import { DEFAULT_RULE_PACK } from '@/lib/gst/ruleset';
import type { BusinessRecord, InvoiceLine, InvoiceTotals } from '@/lib/domain/types';
import type { SupplyFlag } from '@/lib/gst/scenarios';

/**
 * The single place where an invoice's numbers and legal standing are decided.
 *
 * Both the draft preview and the issuance transaction call this, so what the
 * owner reviews is produced by the same code that commits -- there is no second,
 * "display only" calculation that could disagree with the stored total.
 */

export interface PricedInvoice {
  totals: InvoiceTotals;
  computation: TaxComputation;
  assessment: IssuanceAssessment;
}

export function priceInvoice(args: {
  business: BusinessRecord;
  lines: readonly InvoiceLine[];
  placeOfSupplyStateCode: string | null;
  supplyFlags: readonly SupplyFlag[];
  issueDate: CivilDate;
}): PricedInvoice {
  const { business, lines, placeOfSupplyStateCode, supplyFlags, issueDate } = args;

  const assessment = assessIssuance(
    {
      registrationType: business.registrationType,
      sellerStateCode: business.stateCode,
      sellerGstin: business.gstin,
      placeOfSupplyStateCode,
      supplyFlags,
      declaredAggregateTurnoverPaise: business.declaredAggregateTurnoverPaise,
      eInvoicingSelfDeclaredNotApplicable: business.eInvoicingSelfDeclaredNotApplicable,
      issueDate,
      // A line saved before this field existed counts as answered: the owner
      // is not retrospectively accused of skipping a question we never asked.
      linesMissingRate: lines.filter((l) => l.taxRateChosen === false).length,
    },
    DEFAULT_RULE_PACK,
  );

  // A draft for a business that cannot charge GST still needs sensible totals, so
  // the computation runs with tax switched off rather than refusing to price.
  const chargesGst = assessment.chargesGst && Boolean(business.stateCode) && Boolean(placeOfSupplyStateCode);

  const computation = computeTax({
    sellerStateCode: business.stateCode,
    placeOfSupplyStateCode: chargesGst ? placeOfSupplyStateCode : null,
    chargesGst,
    roundToNearestRupee: business.roundToNearestRupee,
    lines: lines.map((l) => ({
      id: l.id,
      description: l.description,
      quantityMilli: l.quantityMilli,
      unitPricePaise: l.unitPricePaise,
      discountPaise: l.discountPaise,
      taxRateBp: l.taxRateBp,
      cessRateBp: l.cessRateBp,
      priceIncludesTax: l.priceIncludesTax,
      hsnCode: l.hsnCode,
      unit: l.unit,
    })),
  });

  const totals: InvoiceTotals = {
    subtotalPaise: computation.subtotalPaise,
    totalDiscountPaise: computation.totalDiscountPaise,
    taxableValuePaise: computation.taxableValuePaise,
    cgstPaise: computation.cgstPaise,
    sgstPaise: computation.sgstPaise,
    igstPaise: computation.igstPaise,
    cessPaise: computation.cessPaise,
    totalTaxPaise: computation.totalTaxPaise,
    totalBeforeRoundingPaise: computation.totalBeforeRoundingPaise,
    roundOffPaise: computation.roundOffPaise,
    grandTotalPaise: computation.grandTotalPaise,
  };

  return { totals, computation, assessment };
}

export function computeDueDate(issueDate: CivilDate, termsDays: number | null): CivilDate | null {
  if (termsDays === null || termsDays === undefined) return null;
  return addDays(issueDate, termsDays);
}

/**
 * Balance = total + debit adjustments - credits - payments - settlement deductions.
 *
 * Kept as one function so every screen and every export agrees on what "still to
 * collect" means.
 */
export function computeBalance(args: {
  grandTotalPaise: number;
  amountPaidPaise: number;
  creditAppliedPaise: number;
  debitAppliedPaise: number;
  settlementDeductionPaise: number;
}): number {
  return (
    args.grandTotalPaise +
    args.debitAppliedPaise -
    args.creditAppliedPaise -
    args.amountPaidPaise -
    args.settlementDeductionPaise
  );
}

export function paymentStatusFor(balancePaise: number, grandTotalPaise: number): 'unpaid' | 'partly-paid' | 'paid' {
  if (balancePaise <= 0) return 'paid';
  if (balancePaise < grandTotalPaise) return 'partly-paid';
  return 'unpaid';
}
