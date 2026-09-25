/**
 * Whether a period may be declared ready.
 *
 * This module exists to say NO. A return is a legal filing, and the cheapest
 * moment to catch a wrong one is before it is sent. Every rule below blocks
 * readiness rather than warning about it, because a warning on a screen an
 * owner has already scrolled past is not a control.
 */

import { createHash } from 'node:crypto';

import { compareDates, periodBounds, todayIst, type CivilDate, type MonthPeriod } from '@/lib/dates';
import { formatMoneyIndian } from '@/lib/money';

import type {
  CompletenessDeclaration,
  GstStatementSnapshotRecord,
  ReconciliationFindingRecord,
  SupplierBillRecord,
} from './types';
import type { Gstr3bWorkings, OutwardDocument } from './workings';

export interface Blocker {
  code: string;
  message: string;
  whatYouCanDo: string;
}

export interface ReadinessInput {
  period: MonthPeriod;
  outwardDocuments: readonly OutwardDocument[];
  supplierBills: readonly SupplierBillRecord[];
  findings: readonly ReconciliationFindingRecord[];
  snapshot: GstStatementSnapshotRecord | null;
  workings: Gstr3bWorkings;
  completeness: CompletenessDeclaration | null;
  /** Whether the statutory due date is known from a VERIFIED rule. */
  dueDateVerified: boolean;
  /** Whether every legal parameter the workings relied on was verified. */
  rulePackFullyVerified: boolean;
  /** Latest change to any source record, used to detect a stale snapshot. */
  latestSourceChangeAt: string | null;
  today?: CivilDate;
}

export interface ReadinessResult {
  ready: boolean;
  blockers: Blocker[];
  warnings: Blocker[];
}

export function assessReadiness(input: ReadinessInput): ReadinessResult {
  const blockers: Blocker[] = [];
  const warnings: Blocker[] = [];

  // --- the owner must state that the data is complete ---------------------
  // Sales invoices alone are not a complete GSTR-3B, and an empty app is not a
  // nil return. We ask, explicitly, and refuse to proceed without an answer.
  if (!input.completeness) {
    blockers.push({
      code: 'completeness-not-declared',
      message: 'We need you to confirm that everything for this period is included.',
      whatYouCanDo: 'Answer the few questions in step 1 about your sales, purchases and anything else you owe tax on.',
    });
  } else {
    if (!input.completeness.allSalesIncluded) {
      blockers.push({
        code: 'sales-incomplete',
        message: 'You said not all of your sales for this period are here.',
        whatYouCanDo: 'Add the missing sales, or import them, before preparing the return.',
      });
    }
    if (!input.completeness.allPurchasesIncluded) {
      blockers.push({
        code: 'purchases-incomplete',
        message: 'You said not all of your purchases for this period are here.',
        whatYouCanDo: 'Add or import the missing supplier bills.',
      });
    }
    if (!input.completeness.otherLiabilitiesConsidered) {
      blockers.push({
        code: 'other-liabilities-unconsidered',
        message: 'You have not confirmed whether you owe tax on anything else this period.',
        whatYouCanDo:
          'Check with your accountant about things this app does not handle, such as tax you owe on purchases under reverse charge, imports or advances.',
      });
    }
  }

  const hasSales = input.outwardDocuments.length > 0;
  const hasPurchases = input.supplierBills.length > 0;

  /**
   * GATE: "nil-sales with purchases/other liabilities cannot become a false nil
   * return." An empty sales list means nothing on its own.
   */
  if (!hasSales) {
    if (hasPurchases) {
      blockers.push({
        code: 'no-sales-but-purchases',
        message: 'There are no sales for this period, but you have entered purchases.',
        whatYouCanDo:
          'A period with no sales is not automatically a nil return. Please confirm with your accountant before filing.',
      });
    } else if (!input.completeness?.confirmedNilIfEmpty) {
      blockers.push({
        code: 'nil-not-confirmed',
        message: 'There is nothing recorded for this period.',
        whatYouCanDo:
          'If you genuinely had no business this period, tick the box confirming it. We will not assume a nil return just because the app is empty.',
      });
    }
  }

  // --- unsupported liabilities -------------------------------------------
  const reverseChargeBills = input.supplierBills.filter((b) => b.reverseCharge);
  if (reverseChargeBills.length > 0) {
    blockers.push({
      code: 'reverse-charge-not-supported',
      message: `${reverseChargeBills.length} of your purchases are marked as ones where you pay the tax yourself (reverse charge). This app cannot work out that tax.`,
      whatYouCanDo: 'Your accountant needs to handle these. We have kept them listed so nothing is forgotten.',
    });
  }

  // --- statement freshness ------------------------------------------------
  if (!input.snapshot) {
    blockers.push({
      code: 'no-statement',
      message: 'No GSTR-2B statement has been imported for this period.',
      whatYouCanDo: 'Download it from the GST portal and import it, so your purchases can be checked against it.',
    });
  } else {
    if (input.snapshot.period !== input.period) {
      blockers.push({
        code: 'statement-wrong-period',
        message: `The imported statement is for ${input.snapshot.period}, not ${input.period}.`,
        whatYouCanDo: 'Import the statement for the right period.',
      });
    }
    if (input.snapshot.supersededBySnapshotId) {
      blockers.push({
        code: 'statement-superseded',
        message: 'A newer version of the statement has been imported.',
        whatYouCanDo: 'Prepare the return again using the newer statement.',
      });
    }
    /**
     * GATE: "stale statements block readiness." If source records changed after
     * the statement was imported, what was reconciled is no longer what is there.
     */
    if (input.latestSourceChangeAt && input.snapshot.importedAt < input.latestSourceChangeAt) {
      blockers.push({
        code: 'statement-stale',
        message: 'Your purchase records changed after the statement was imported, so the checks are out of date.',
        whatYouCanDo: 'Import a fresh statement, or re-run the checks, before declaring this period ready.',
      });
    }
  }

  // --- reconciliation findings -------------------------------------------
  const unresolvedBlocking = input.findings.filter((f) => !f.resolved && f.severity === 'blocking');
  if (unresolvedBlocking.length > 0) {
    blockers.push({
      code: 'unresolved-findings',
      message: `${unresolvedBlocking.length} ${unresolvedBlocking.length === 1 ? 'problem needs' : 'problems need'} checking before this return is ready.`,
      whatYouCanDo: 'Open step 2 and deal with each one. You can record why you are leaving something as it is.',
    });
  }
  const unresolvedWarnings = input.findings.filter((f) => !f.resolved && f.severity === 'warning');
  if (unresolvedWarnings.length > 0) {
    warnings.push({
      code: 'unresolved-warnings',
      message: `${unresolvedWarnings.length} thing${unresolvedWarnings.length === 1 ? '' : 's'} worth a look before you file.`,
      whatYouCanDo: 'Open step 2 to review them.',
    });
  }

  /**
   * GATE: "ineligible ITC is not claimed automatically." Unreviewed credit
   * contributes nothing to the workings, and we say so rather than quietly
   * dropping it.
   */
  const unreviewed = input.supplierBills.filter((b) => b.itcEligibility === 'not-reviewed');
  if (unreviewed.length > 0) {
    const unreviewedTax = unreviewed.reduce((n, b) => n + b.cgstPaise + b.sgstPaise + b.igstPaise + b.cessPaise, 0);
    blockers.push({
      code: 'itc-not-reviewed',
      message: `${unreviewed.length} purchase ${unreviewed.length === 1 ? 'bill has' : 'bills have'} not been checked for credit (${formatMoneyIndian(unreviewedTax, { withSymbol: true })} of GST).`,
      whatYouCanDo:
        'Go through them in step 2 and say for each whether you can claim the credit. We never claim credit on your behalf.',
    });
  }

  // --- provisional figures ------------------------------------------------
  if (input.workings.cashFigureIsProvisional) {
    warnings.push({
      code: 'cash-provisional',
      message: 'The amount to pay is an estimate, because we do not have your ledger balances from the GST portal.',
      whatYouCanDo: 'Import your ledger summary, or check the final amount on the portal before paying.',
    });
  }

  // --- rule provenance ----------------------------------------------------
  if (!input.rulePackFullyVerified) {
    blockers.push({
      code: 'rules-unverified',
      message: 'Some GST rules this return depends on have not been confirmed against the official source in this installation.',
      whatYouCanDo:
        'This is a setup step for whoever runs this app. Until it is done, we will not tell you a return is ready to file.',
    });
  }
  if (!input.dueDateVerified) {
    warnings.push({
      code: 'due-date-unverified',
      message: 'We cannot show you a due date for this period, because we do not have a confirmed rule for it.',
      whatYouCanDo: 'Check the due date on the GST portal or with your accountant. We will not guess one.',
    });
  }

  // --- period sanity ------------------------------------------------------
  const today = input.today ?? todayIst();
  const bounds = periodBounds(input.period);
  if (compareDates(bounds.end, today) > 0) {
    warnings.push({
      code: 'period-not-finished',
      message: 'This period has not finished yet.',
      whatYouCanDo: 'More sales or purchases may still come in. You can prepare now, but check again at the end of the period.',
    });
  }

  return { ready: blockers.length === 0, blockers, warnings };
}

/**
 * A fingerprint over everything that fed a prepared return.
 *
 * GATE: "post-review changes invalidate approval." An approval is bound to this
 * fingerprint. If any source record changes afterwards, the fingerprint moves
 * and the approval no longer applies -- so a changed payload can never be
 * submitted under an earlier approval.
 */
export function sourceFingerprint(args: {
  outwardDocuments: readonly OutwardDocument[];
  supplierBills: readonly SupplierBillRecord[];
  snapshotId: string | null;
  snapshotHash: string | null;
  completeness: CompletenessDeclaration | null;
  rulePackVersion: string;
}): string {
  const hash = createHash('sha256');
  hash.update(`rulepack:${args.rulePackVersion}\n`);
  hash.update(`snapshot:${args.snapshotId ?? 'none'}:${args.snapshotHash ?? 'none'}\n`);
  hash.update(
    `completeness:${
      args.completeness
        ? [
            args.completeness.allSalesIncluded,
            args.completeness.allPurchasesIncluded,
            args.completeness.otherLiabilitiesConsidered,
            args.completeness.confirmedNilIfEmpty,
          ].join(',')
        : 'none'
    }\n`,
  );

  // Sorted so that record ORDER cannot change the fingerprint, while any
  // change to a value does.
  for (const d of [...args.outwardDocuments].sort((a, b) => a.id.localeCompare(b.id))) {
    hash.update(
      `out:${d.id}:${d.documentNumber}:${d.documentDate}:${d.documentType}:${d.taxableValuePaise}:${d.cgstPaise}:${d.sgstPaise}:${d.igstPaise}:${d.cessPaise}\n`,
    );
  }
  for (const b of [...args.supplierBills].sort((a, b2) => a.id.localeCompare(b2.id))) {
    hash.update(
      `in:${b.id}:${b.documentNumber}:${b.documentDate}:${b.taxableValuePaise}:${b.cgstPaise}:${b.sgstPaise}:${b.igstPaise}:${b.cessPaise}:${b.itcEligibility}:${b.eligibleCgstPaise}:${b.eligibleSgstPaise}:${b.eligibleIgstPaise}:${b.eligibleCessPaise}\n`,
    );
  }
  return hash.digest('hex');
}

export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

/** Deterministic JSON, so an identical payload always hashes identically. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}
