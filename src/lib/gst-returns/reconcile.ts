/**
 * Reconcile the owner's purchase register against an imported GSTR-2B snapshot.
 *
 * WHAT THIS IS FOR: telling the owner, in plain words, where their books and
 * the portal's statement disagree -- and refusing to let a return be declared
 * ready while a disagreement that matters is unresolved.
 *
 * WHAT THIS IS NOT: a decision about input tax credit. A document appearing in
 * GSTR-2B does not make its credit claimable, and this module never marks
 * anything eligible. Eligibility is a reviewed field on the supplier bill,
 * recorded by a person.
 */

import { randomUUID } from 'node:crypto';

import type { MonthPeriod } from '@/lib/dates';
import { formatMoneyIndian } from '@/lib/money';

import { amountsAgree, compareDocuments, matchKey, type MatchCandidate } from './matching';
import type {
  GstStatementSnapshotRecord,
  ReconciliationFindingRecord,
  SupplierBillRecord,
} from './types';

export interface ReconcileInput {
  gstin: string;
  period: MonthPeriod;
  supplierBills: readonly SupplierBillRecord[];
  snapshot: GstStatementSnapshotRecord | null;
  nowIso: string;
}

export interface ReconcileResult {
  findings: ReconciliationFindingRecord[];
  matchedCount: number;
  /** Totals the owner's own books claim, before any eligibility review. */
  booksTaxPaise: number;
  /** Totals the statement shows. */
  statementTaxPaise: number;
}

function totalTax(r: { cgstPaise: number; sgstPaise: number; igstPaise: number; cessPaise: number }): number {
  return r.cgstPaise + r.sgstPaise + r.igstPaise + r.cessPaise;
}

function finding(
  base: Pick<ReconciliationFindingRecord, 'gstin' | 'period' | 'kind' | 'severity' | 'message' | 'whatYouCanDo'> &
    Partial<ReconciliationFindingRecord>,
  nowIso: string,
): ReconciliationFindingRecord {
  return {
    id: randomUUID(),
    supplierName: null,
    supplierGstin: null,
    documentNumber: null,
    bookAmountPaise: null,
    statementAmountPaise: null,
    differencePaise: null,
    supplierBillId: null,
    snapshotId: null,
    reviewedByUid: null,
    reviewedAt: null,
    reviewReason: null,
    resolved: false,
    createdAt: nowIso,
    ...base,
  } as ReconciliationFindingRecord;
}

export function reconcilePurchases(input: ReconcileInput): ReconcileResult {
  const { gstin, period, supplierBills, snapshot, nowIso } = input;
  const findings: ReconciliationFindingRecord[] = [];

  const booksTaxPaise = supplierBills.reduce((n, b) => n + totalTax(b), 0);
  const statementTaxPaise = snapshot?.rows.reduce((n, r) => n + totalTax(r), 0) ?? 0;

  // --- duplicates within the books ----------------------------------------
  const byKey = new Map<string, SupplierBillRecord[]>();
  for (const bill of supplierBills) {
    const key = `${bill.supplierGstin ?? 'unknown'}|${bill.matchKey || matchKey(bill.documentNumber)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), bill]);
  }
  for (const [, group] of byKey) {
    if (group.length <= 1) continue;
    findings.push(
      finding(
        {
          gstin,
          period,
          kind: 'duplicate-in-books',
          severity: 'blocking',
          message: `You have entered ${group.length} purchase bills with the number ${group[0]!.documentNumber} from ${group[0]!.supplierName}.`,
          whatYouCanDo: 'Check whether this bill was entered twice, and delete the extra one. Counting it twice would overstate your credit.',
          supplierName: group[0]!.supplierName,
          supplierGstin: group[0]!.supplierGstin,
          documentNumber: group[0]!.documentNumber,
          supplierBillId: group[0]!.id,
          bookAmountPaise: group.reduce((n, b) => n + totalTax(b), 0),
        },
        nowIso,
      ),
    );
  }

  if (!snapshot) {
    findings.push(
      finding(
        {
          gstin,
          period,
          kind: 'missing-in-statement',
          severity: 'blocking',
          message: 'No GSTR-2B statement has been imported for this period.',
          whatYouCanDo:
            'Download GSTR-2B for this period from the GST portal and import it here, so we can check your purchase bills against it.',
        },
        nowIso,
      ),
    );
    return { findings, matchedCount: 0, booksTaxPaise, statementTaxPaise };
  }

  // --- duplicates within the statement ------------------------------------
  const statementByKey = new Map<string, typeof snapshot.rows>();
  for (const row of snapshot.rows) {
    const key = `${row.supplierGstin ?? 'unknown'}|${row.matchKey}`;
    statementByKey.set(key, [...(statementByKey.get(key) ?? []), row]);
  }
  for (const [, group] of statementByKey) {
    if (group.length <= 1) continue;
    findings.push(
      finding(
        {
          gstin,
          period,
          kind: 'duplicate-in-statement',
          severity: 'warning',
          message: `The statement lists bill ${group[0]!.documentNumber} from ${group[0]!.supplierName} more than once.`,
          whatYouCanDo: 'Check with your supplier. Do not claim the credit twice.',
          supplierName: group[0]!.supplierName,
          supplierGstin: group[0]!.supplierGstin,
          documentNumber: group[0]!.documentNumber,
          snapshotId: snapshot.id,
          statementAmountPaise: group.reduce((n, r) => n + totalTax(r), 0),
        },
        nowIso,
      ),
    );
  }

  // --- match books against statement --------------------------------------
  const unmatchedStatement = new Set(snapshot.rows.map((_, i) => i));
  let matchedCount = 0;

  for (const bill of supplierBills) {
    const billCandidate: MatchCandidate = {
      documentNumber: bill.documentNumber,
      matchKey: bill.matchKey || matchKey(bill.documentNumber),
      documentDate: bill.documentDate,
      supplierGstin: bill.supplierGstin,
      totalTaxPaise: totalTax(bill),
    };

    let bestIndex = -1;
    let bestQuality: 'exact' | 'loose' | 'none' = 'none';

    for (let i = 0; i < snapshot.rows.length; i += 1) {
      if (!unmatchedStatement.has(i)) continue;
      const row = snapshot.rows[i]!;
      const quality = compareDocuments(billCandidate, {
        documentNumber: row.documentNumber,
        matchKey: row.matchKey,
        documentDate: row.documentDate,
        supplierGstin: row.supplierGstin,
        totalTaxPaise: totalTax(row),
      });
      if (quality === 'exact') {
        bestIndex = i;
        bestQuality = 'exact';
        break;
      }
      if (quality === 'loose' && bestQuality === 'none') {
        bestIndex = i;
        bestQuality = 'loose';
      }
    }

    if (bestIndex === -1) {
      findings.push(
        finding(
          {
            gstin,
            period,
            kind: 'missing-in-statement',
            severity: 'blocking',
            message: `Your bill ${bill.documentNumber} from ${bill.supplierName} is not in the GST statement for this period.`,
            whatYouCanDo:
              'Your supplier may not have reported it yet. Ask them to check. Claiming credit for a bill that is not in the statement can be questioned later.',
            supplierName: bill.supplierName,
            supplierGstin: bill.supplierGstin,
            documentNumber: bill.documentNumber,
            supplierBillId: bill.id,
            bookAmountPaise: totalTax(bill),
            snapshotId: snapshot.id,
          },
          nowIso,
        ),
      );
      continue;
    }

    unmatchedStatement.delete(bestIndex);
    const row = snapshot.rows[bestIndex]!;
    const statementTotal = totalTax(row);
    const bookTotal = totalTax(bill);

    if (bestQuality === 'loose') {
      // A match we only found by normalising aggressively is a SUGGESTION.
      findings.push(
        finding(
          {
            gstin,
            period,
            kind: 'fuzzy-match-needs-review',
            severity: 'warning',
            message: `Your bill ${bill.documentNumber} looks like statement entry ${row.documentNumber} from ${row.supplierName}, but the numbers are written differently.`,
            whatYouCanDo: 'Check they are the same bill before relying on this match.',
            supplierName: bill.supplierName,
            supplierGstin: bill.supplierGstin,
            documentNumber: bill.documentNumber,
            supplierBillId: bill.id,
            snapshotId: snapshot.id,
            bookAmountPaise: bookTotal,
            statementAmountPaise: statementTotal,
            differencePaise: bookTotal - statementTotal,
          },
          nowIso,
        ),
      );
    }

    if (!amountsAgree(bookTotal, statementTotal)) {
      findings.push(
        finding(
          {
            gstin,
            period,
            kind: 'amount-mismatch',
            severity: 'blocking',
            message: `Bill ${bill.documentNumber} from ${bill.supplierName}: your books say ${formatMoneyIndian(bookTotal, { withSymbol: true })} of GST, the statement says ${formatMoneyIndian(statementTotal, { withSymbol: true })}.`,
            whatYouCanDo: 'Check the bill against what your supplier reported, and correct whichever is wrong.',
            supplierName: bill.supplierName,
            supplierGstin: bill.supplierGstin,
            documentNumber: bill.documentNumber,
            supplierBillId: bill.id,
            snapshotId: snapshot.id,
            bookAmountPaise: bookTotal,
            statementAmountPaise: statementTotal,
            differencePaise: bookTotal - statementTotal,
          },
          nowIso,
        ),
      );
    } else if (bill.documentDate !== row.documentDate) {
      findings.push(
        finding(
          {
            gstin,
            period,
            kind: 'date-mismatch',
            severity: 'warning',
            message: `Bill ${bill.documentNumber}: your books show ${bill.documentDate}, the statement shows ${row.documentDate}.`,
            whatYouCanDo: 'Correct the date in your books if it was typed wrongly.',
            supplierName: bill.supplierName,
            documentNumber: bill.documentNumber,
            supplierBillId: bill.id,
            snapshotId: snapshot.id,
          },
          nowIso,
        ),
      );
      matchedCount += 1;
    } else if (bestQuality === 'exact') {
      matchedCount += 1;
    }
  }

  // --- statement entries with no bill in the books ------------------------
  for (const index of unmatchedStatement) {
    const row = snapshot.rows[index]!;
    findings.push(
      finding(
        {
          gstin,
          period,
          kind: 'missing-in-books',
          severity: 'warning',
          message: `The statement shows a bill ${row.documentNumber} from ${row.supplierName} that is not in your purchase records.`,
          whatYouCanDo:
            'If you did buy this, add it to your purchases. If you did not, leave it out and do not claim the credit.',
          supplierName: row.supplierName,
          supplierGstin: row.supplierGstin,
          documentNumber: row.documentNumber,
          snapshotId: snapshot.id,
          statementAmountPaise: totalTax(row),
        },
        nowIso,
      ),
    );
  }

  return { findings, matchedCount, booksTaxPaise, statementTaxPaise };
}

/** Credit the owner has actually reviewed and confirmed as claimable. */
export function reviewedEligibleItc(bills: readonly SupplierBillRecord[]): {
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  unreviewedCount: number;
  unreviewedTaxPaise: number;
} {
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  let cess = 0;
  let unreviewedCount = 0;
  let unreviewedTaxPaise = 0;

  for (const bill of bills) {
    // Anything not reviewed contributes NOTHING. Silence is not consent.
    if (bill.itcEligibility === 'not-reviewed') {
      unreviewedCount += 1;
      unreviewedTaxPaise += totalTax(bill);
      continue;
    }
    if (bill.itcEligibility === 'ineligible' || bill.itcEligibility === 'blocked' || bill.itcEligibility === 'deferred') {
      continue;
    }
    // 'eligible' and 'partial' both use the explicitly reviewed figures.
    cgst += bill.eligibleCgstPaise;
    sgst += bill.eligibleSgstPaise;
    igst += bill.eligibleIgstPaise;
    cess += bill.eligibleCessPaise;
  }

  return { cgstPaise: cgst, sgstPaise: sgst, igstPaise: igst, cessPaise: cess, unreviewedCount, unreviewedTaxPaise };
}
