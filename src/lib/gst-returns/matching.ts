/**
 * Document matching keys.
 *
 * Suppliers write the same invoice number a dozen ways: "INV/2026/001",
 * "inv-2026-001", "INV 2026 001". Matching on the raw string misses genuine
 * matches; matching too loosely invents them.
 *
 * So we keep BOTH: the original document number exactly as printed (which is
 * what appears in a return and what a supplier will recognise), and a
 * normalised key used only for comparison. A match found only after aggressive
 * normalisation is reported as needing review, never accepted silently.
 */

import type { CivilDate } from '@/lib/dates';

/** Conservative normalisation: case, spacing and separator noise only. */
export function matchKey(documentNumber: string): string {
  return documentNumber
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^0+(?=\d)/, '');
}

/** A looser key that also drops leading zeros inside segments and a year prefix. */
export function looseMatchKey(documentNumber: string): string {
  const base = matchKey(documentNumber);
  // Strip a leading 4-digit year, which suppliers add or omit inconsistently.
  return base.replace(/^(19|20)\d{2}/, '').replace(/0+(?=\d)/g, '');
}

export interface MatchCandidate {
  documentNumber: string;
  matchKey: string;
  documentDate: CivilDate;
  supplierGstin: string | null;
  totalTaxPaise: number;
}

export type MatchQuality = 'exact' | 'loose' | 'none';

export function compareDocuments(a: MatchCandidate, b: MatchCandidate): MatchQuality {
  // A GSTIN mismatch is decisive: two different suppliers are never the same bill.
  if (a.supplierGstin && b.supplierGstin && a.supplierGstin !== b.supplierGstin) return 'none';
  if (a.matchKey && a.matchKey === b.matchKey) return 'exact';
  if (looseMatchKey(a.documentNumber) && looseMatchKey(a.documentNumber) === looseMatchKey(b.documentNumber)) {
    return 'loose';
  }
  return 'none';
}

/** Tolerance for "the amounts agree": exact, in paise. Money is not fuzzy. */
export function amountsAgree(a: number, b: number): boolean {
  return a === b;
}
