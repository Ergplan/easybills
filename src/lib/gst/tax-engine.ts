/**
 * Deterministic invoice tax computation.
 *
 * This module is PURE ARITHMETIC over integers. It contains no legal thresholds
 * and makes no judgement about whether a document may be issued -- that is
 * `scenarios.ts`. Given a seller, a confirmed place of supply and a set of lines
 * whose tax rates the OWNER has stated, it produces the same numbers every time.
 *
 * Splitting rule for an intra-state supply: CGST and SGST/UTGST are each computed
 * from the taxable value at half the stated rate, independently. They are not
 * derived from one another, and neither is computed as "total tax minus the other
 * head" -- that would hide a half-paise in whichever head happened to be second.
 * Where the two halves differ by one paise because the rate is odd in basis
 * points, the difference is reported in `headRoundingNote` rather than absorbed.
 */

import {
  applyBasisPoints,
  assertSafe,
  divRound,
  lineGross,
  roundToRupee,
  sum,
  taxableFromInclusive,
  type BasisPoints,
  type Milli,
  type Paise,
} from '@/lib/money';
import { findState, type TaxAuthority } from './state-codes';

export type SupplyType = 'intra-state' | 'inter-state' | 'no-gst';

export interface TaxLineInput {
  /** Stable id so the caller can map results back to its own line objects. */
  id: string;
  description: string;
  quantityMilli: Milli;
  unitPricePaise: Paise;
  /** Line discount in paise (absolute). Applied before tax. */
  discountPaise?: Paise;
  /** GST rate in basis points, as stated by the owner. 1800 = 18%. */
  taxRateBp: BasisPoints;
  /** Compensation cess in basis points, if any. Kept as a distinct head. */
  cessRateBp?: BasisPoints;
  /** When true, `unitPricePaise` already contains the tax. */
  priceIncludesTax?: boolean;
  hsnCode?: string | null;
  unit?: string | null;
}

export interface TaxLineResult {
  id: string;
  description: string;
  quantityMilli: Milli;
  unitPricePaise: Paise;
  /** quantity x unit price, before discount. */
  grossPaise: Paise;
  discountPaise: Paise;
  /** The value GST is charged on. */
  taxableValuePaise: Paise;
  taxRateBp: BasisPoints;
  cessRateBp: BasisPoints;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  cessPaise: Paise;
  totalTaxPaise: Paise;
  /** taxable + all tax heads. */
  lineTotalPaise: Paise;
  hsnCode: string | null;
  unit: string | null;
}

export interface TaxComputationInput {
  /** Seller's registered state code, e.g. "27". Null when unregistered. */
  sellerStateCode: string | null;
  /**
   * The place of supply the owner CONFIRMED for this invoice. Never inferred
   * silently from the customer's address -- see scenarios.ts.
   */
  placeOfSupplyStateCode: string | null;
  /** Whether GST is charged at all. False for unregistered sellers. */
  chargesGst: boolean;
  lines: readonly TaxLineInput[];
  /** Round the grand total to the nearest rupee, carried as a visible line. */
  roundToNearestRupee: boolean;
}

export interface TaxComputation {
  supplyType: SupplyType;
  stateTaxAuthority: TaxAuthority | null;
  lines: TaxLineResult[];
  subtotalPaise: Paise;
  totalDiscountPaise: Paise;
  taxableValuePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  cessPaise: Paise;
  totalTaxPaise: Paise;
  /** taxable + tax, before the rupee round-off. */
  totalBeforeRoundingPaise: Paise;
  roundOffPaise: Paise;
  grandTotalPaise: Paise;
  /** Rate-wise summary, which is what GST return tables are built from. */
  rateSummary: Array<{
    taxRateBp: BasisPoints;
    cessRateBp: BasisPoints;
    taxableValuePaise: Paise;
    cgstPaise: Paise;
    sgstPaise: Paise;
    igstPaise: Paise;
    cessPaise: Paise;
  }>;
  headRoundingNote: string | null;
}

export class TaxEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaxEngineError';
  }
}

export function determineSupplyType(input: {
  sellerStateCode: string | null;
  placeOfSupplyStateCode: string | null;
  chargesGst: boolean;
}): SupplyType {
  if (!input.chargesGst) return 'no-gst';
  if (!input.sellerStateCode) throw new TaxEngineError('A GST-charging seller must have a registered state');
  if (!input.placeOfSupplyStateCode) throw new TaxEngineError('Place of supply must be confirmed before tax can be computed');
  return input.sellerStateCode === input.placeOfSupplyStateCode ? 'intra-state' : 'inter-state';
}

export function computeTax(input: TaxComputationInput): TaxComputation {
  const supplyType = determineSupplyType(input);
  const posState = findState(input.placeOfSupplyStateCode);
  const stateTaxAuthority: TaxAuthority | null = supplyType === 'intra-state' ? posState?.taxAuthority ?? 'SGST' : null;

  const headNotes: string[] = [];

  const lines: TaxLineResult[] = input.lines.map((line) => {
    const quantityMilli = assertSafe(line.quantityMilli, 'quantity');
    if (quantityMilli < 0) throw new TaxEngineError(`Quantity cannot be negative on "${line.description}"`);
    const unitPricePaise = assertSafe(line.unitPricePaise, 'unit price');
    if (unitPricePaise < 0) throw new TaxEngineError(`Price cannot be negative on "${line.description}"`);

    const taxRateBp = supplyType === 'no-gst' ? 0 : assertSafe(line.taxRateBp, 'tax rate');
    const cessRateBp = supplyType === 'no-gst' ? 0 : assertSafe(line.cessRateBp ?? 0, 'cess rate');
    if (taxRateBp < 0 || taxRateBp > 100_000) throw new TaxEngineError(`Tax rate out of range on "${line.description}"`);
    if (cessRateBp < 0 || cessRateBp > 100_000) throw new TaxEngineError(`Cess rate out of range on "${line.description}"`);

    const grossRaw = lineGross(quantityMilli, unitPricePaise);
    const discountPaise = assertSafe(line.discountPaise ?? 0, 'discount');
    if (discountPaise < 0) throw new TaxEngineError(`Discount cannot be negative on "${line.description}"`);
    if (discountPaise > grossRaw) throw new TaxEngineError(`Discount is larger than the line amount on "${line.description}"`);

    // For tax-inclusive pricing the entered figure contains tax AND cess, so the
    // taxable value is backed out using the combined rate, then each head is
    // recomputed forward from that taxable value. That keeps one code path.
    const netEntered = grossRaw - discountPaise;
    const combinedBp = taxRateBp + cessRateBp;
    const taxableValuePaise = line.priceIncludesTax && supplyType !== 'no-gst'
      ? taxableFromInclusive(netEntered, combinedBp)
      : netEntered;

    let cgstPaise = 0;
    let sgstPaise = 0;
    let igstPaise = 0;
    if (supplyType === 'intra-state') {
      // Half the rate to each head, each computed from the taxable value.
      const halfBp = divRound(taxRateBp, 2);
      cgstPaise = applyBasisPoints(taxableValuePaise, halfBp);
      sgstPaise = applyBasisPoints(taxableValuePaise, taxRateBp - halfBp);
      if (cgstPaise !== sgstPaise) {
        headNotes.push(
          `"${line.description}": an odd tax rate splits unevenly, so CGST and ${stateTaxAuthority} differ by ` +
            `${Math.abs(cgstPaise - sgstPaise)} paise.`,
        );
      }
    } else if (supplyType === 'inter-state') {
      igstPaise = applyBasisPoints(taxableValuePaise, taxRateBp);
    }
    const cessPaise = supplyType === 'no-gst' ? 0 : applyBasisPoints(taxableValuePaise, cessRateBp);
    const totalTaxPaise = cgstPaise + sgstPaise + igstPaise + cessPaise;

    return {
      id: line.id,
      description: line.description,
      quantityMilli,
      unitPricePaise,
      grossPaise: grossRaw,
      discountPaise,
      taxableValuePaise,
      taxRateBp,
      cessRateBp,
      cgstPaise,
      sgstPaise,
      igstPaise,
      cessPaise,
      totalTaxPaise,
      lineTotalPaise: taxableValuePaise + totalTaxPaise,
      hsnCode: line.hsnCode ?? null,
      unit: line.unit ?? null,
    };
  });

  const subtotalPaise = sum(lines.map((l) => l.grossPaise));
  const totalDiscountPaise = sum(lines.map((l) => l.discountPaise));
  const taxableValuePaise = sum(lines.map((l) => l.taxableValuePaise));
  const cgstPaise = sum(lines.map((l) => l.cgstPaise));
  const sgstPaise = sum(lines.map((l) => l.sgstPaise));
  const igstPaise = sum(lines.map((l) => l.igstPaise));
  const cessPaise = sum(lines.map((l) => l.cessPaise));
  const totalTaxPaise = cgstPaise + sgstPaise + igstPaise + cessPaise;
  const totalBeforeRoundingPaise = taxableValuePaise + totalTaxPaise;
  const grandTotalPaise = input.roundToNearestRupee ? roundToRupee(totalBeforeRoundingPaise) : totalBeforeRoundingPaise;
  const roundOffPaise = grandTotalPaise - totalBeforeRoundingPaise;

  // Rate-wise grouping. GSTR-1 reports by rate, so this is computed once here
  // and reused by the return module rather than being re-derived there.
  const groups = new Map<string, TaxComputation['rateSummary'][number]>();
  for (const l of lines) {
    const key = `${l.taxRateBp}|${l.cessRateBp}`;
    const existing = groups.get(key) ?? {
      taxRateBp: l.taxRateBp,
      cessRateBp: l.cessRateBp,
      taxableValuePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      cessPaise: 0,
    };
    existing.taxableValuePaise += l.taxableValuePaise;
    existing.cgstPaise += l.cgstPaise;
    existing.sgstPaise += l.sgstPaise;
    existing.igstPaise += l.igstPaise;
    existing.cessPaise += l.cessPaise;
    groups.set(key, existing);
  }

  return {
    supplyType,
    stateTaxAuthority,
    lines,
    subtotalPaise,
    totalDiscountPaise,
    taxableValuePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    cessPaise,
    totalTaxPaise,
    totalBeforeRoundingPaise,
    roundOffPaise,
    grandTotalPaise,
    rateSummary: [...groups.values()].sort((a, b) => a.taxRateBp - b.taxRateBp || a.cessRateBp - b.cessRateBp),
    headRoundingNote: headNotes.length ? headNotes.join(' ') : null,
  };
}
