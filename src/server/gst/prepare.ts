import 'server-only';

import { formatPeriodLong, todayIst, type MonthPeriod } from '@/lib/dates';
import type { BusinessRecord } from '@/lib/domain/types';
import { auditRulePack, DEFAULT_RULE_PACK, resolveVerified } from '@/lib/gst/ruleset';
import { reconcilePurchases } from '@/lib/gst-returns/reconcile';
import { assessReadiness, payloadHash, sourceFingerprint, type Blocker } from '@/lib/gst-returns/readiness';
import {
  buildGstr1,
  buildGstr3b,
  outwardDocumentsFromExternal,
  outwardDocumentsFromInvoices,
  type Gstr1Tables,
  type Gstr3bWorkings,
  type LedgerBalances,
  type OutwardDocument,
} from '@/lib/gst-returns/workings';
import { obligationsFor } from '@/lib/gst-returns/qrmp';
import type {
  CompletenessDeclaration,
  GstStatementSnapshotRecord,
  ReconciliationFindingRecord,
  ReturnForm,
  ReturnVersionRecord,
  SupplierBillRecord,
} from '@/lib/gst-returns/types';
import { recordAudit } from '@/server/services/audit';
import { returnPeriodId } from '@/server/firebase/paths';

import {
  getReturnPeriod,
  latestSnapshot,
  listExternalSales,
  listFindings,
  listIssuedInvoicesForPeriod,
  listSupplierBills,
  newId,
  replaceFindings,
  saveReturnVersion,
  upsertReturnPeriod,
} from './repo';

/**
 * Prepare a period.
 *
 * The whole pipeline, in one place: gather the sources, reconcile purchases
 * against the portal statement, build the tables, and assess readiness. It is
 * deterministic -- running it twice on unchanged data produces an identical
 * fingerprint -- which is what lets an approval be bound to exactly what the
 * owner saw.
 */
export interface PreparedPeriod {
  period: MonthPeriod;
  gstin: string;
  forms: ReturnForm[];
  outwardDocuments: OutwardDocument[];
  supplierBills: SupplierBillRecord[];
  snapshot: GstStatementSnapshotRecord | null;
  findings: ReconciliationFindingRecord[];
  gstr1: Gstr1Tables;
  gstr3b: Gstr3bWorkings;
  readiness: { ready: boolean; blockers: Blocker[]; warnings: Blocker[] };
  fingerprint: string;
  dueDate: string | null;
  dueDateVerified: boolean;
  rulePackVersion: string;
  rulePackFullyVerified: boolean;
  /** Counts for the four guided steps. */
  summary: {
    salesCount: number;
    purchaseCount: number;
    unreviewedItcCount: number;
    blockingFindingCount: number;
    warningFindingCount: number;
  };
}

export async function preparePeriod(args: {
  business: BusinessRecord;
  period: MonthPeriod;
  completeness?: CompletenessDeclaration | null;
  persistFindings?: boolean;
}): Promise<PreparedPeriod> {
  const { business, period } = args;
  const config = business.gstReturns;
  if (!config) throw new Error('GST returns are not set up for this business.');

  const gstin = config.gstin;
  const [invoices, externalSales, supplierBills, snapshot] = await Promise.all([
    listIssuedInvoicesForPeriod(business.id, period),
    listExternalSales(business.id, period),
    listSupplierBills(business.id, period),
    latestSnapshot(business.id, gstin, period),
  ]);

  const outwardDocuments = [
    ...outwardDocumentsFromInvoices(invoices),
    ...outwardDocumentsFromExternal(externalSales),
  ];

  const nowIso = new Date().toISOString();
  const reconciliation = reconcilePurchases({ gstin, period, supplierBills, snapshot, nowIso });

  if (args.persistFindings !== false) {
    await replaceFindings(business.id, period, reconciliation.findings);
  }
  // Re-read so owner decisions carried forward by replaceFindings are reflected.
  const findings = args.persistFindings !== false
    ? await listFindings(business.id, period)
    : reconciliation.findings;

  // Ledger balances are NEVER derived from invoice payments or bank receipts.
  // Without an authoritative import they are simply unavailable, and the cash
  // figure is labelled provisional.
  const ledger: LedgerBalances = {
    creditCgstPaise: 0,
    creditSgstPaise: 0,
    creditIgstPaise: 0,
    creditCessPaise: 0,
    cashBalancePaise: 0,
    source: 'unavailable',
    asOf: null,
  };

  const gstr1 = buildGstr1({ period, documents: outwardDocuments });
  const gstr3b = buildGstr3b({ period, outwardDocuments, supplierBills, ledger });

  const audit = auditRulePack(DEFAULT_RULE_PACK);
  const today = todayIst();
  const dueRule =
    config.filingFrequency === 'monthly'
      ? resolveVerified(DEFAULT_RULE_PACK.dueDates.gstr3bMonthly, today)
      : resolveVerified(DEFAULT_RULE_PACK.dueDates.gstr3bQuarterly, today);

  const existingPeriod = await getReturnPeriod(business.id, gstin, 'GSTR-3B', period);
  const completeness = args.completeness ?? existingPeriod?.completeness ?? null;

  const readiness = assessReadiness({
    period,
    outwardDocuments,
    supplierBills,
    findings,
    snapshot,
    workings: gstr3b,
    completeness,
    dueDateVerified: dueRule !== null,
    rulePackFullyVerified: audit.fullyVerified,
    latestSourceChangeAt: latestChange(supplierBills),
    today,
  });

  const fingerprint = sourceFingerprint({
    outwardDocuments,
    supplierBills,
    snapshotId: snapshot?.id ?? null,
    snapshotHash: snapshot?.fileHash ?? null,
    completeness,
    rulePackVersion: DEFAULT_RULE_PACK.version,
  });

  const obligation = obligationsFor(period, config.filingFrequency, config.usesIff);

  return {
    period,
    gstin,
    forms: obligation.forms.map((f) => f.form),
    outwardDocuments,
    supplierBills,
    snapshot,
    findings,
    gstr1,
    gstr3b,
    readiness,
    fingerprint,
    // We show a due date only when a VERIFIED rule gives us one. Never a guess.
    dueDate: null,
    dueDateVerified: dueRule !== null,
    rulePackVersion: DEFAULT_RULE_PACK.version,
    rulePackFullyVerified: audit.fullyVerified,
    summary: {
      salesCount: outwardDocuments.length,
      purchaseCount: supplierBills.length,
      unreviewedItcCount: supplierBills.filter((b) => b.itcEligibility === 'not-reviewed').length,
      blockingFindingCount: findings.filter((f) => !f.resolved && f.severity === 'blocking').length,
      warningFindingCount: findings.filter((f) => !f.resolved && f.severity === 'warning').length,
    },
  };
}

function latestChange(bills: readonly SupplierBillRecord[]): string | null {
  let latest: string | null = null;
  for (const b of bills) {
    if (!latest || b.updatedAt > latest) latest = b.updatedAt;
  }
  return latest;
}

/**
 * Record the owner's completeness answers.
 *
 * These are asked because sales invoices alone are not a complete return, and
 * because an empty app is not a nil return.
 */
export async function declareCompleteness(args: {
  business: BusinessRecord;
  uid: string;
  period: MonthPeriod;
  form: ReturnForm;
  answers: Omit<CompletenessDeclaration, 'declaredByUid' | 'declaredAt'>;
}): Promise<void> {
  const gstin = args.business.gstReturns!.gstin;
  const declaration: CompletenessDeclaration = {
    ...args.answers,
    declaredByUid: args.uid,
    declaredAt: new Date().toISOString(),
  };
  await upsertReturnPeriod(args.business.id, {
    id: returnPeriodId(gstin, args.form, args.period),
    gstin,
    form: args.form,
    period: args.period,
    completeness: declaration,
  });
  await recordAudit(args.business.id, {
    actorUid: args.uid,
    actorKind: 'user',
    action: 'gst.completeness-declared',
    subjectType: 'return-period',
    subjectId: returnPeriodId(gstin, args.form, args.period),
    detail: { period: args.period, form: args.form },
  });
}

/**
 * Create a version and approve it in one deliberate action.
 *
 * The approval is bound to BOTH the source fingerprint and the payload hash. If
 * anything behind it changes afterwards, `checkApprovalStillValid` detects the
 * divergence and the approval is invalidated rather than silently carried over.
 */
export async function approveForFiling(args: {
  business: BusinessRecord;
  uid: string;
  form: ReturnForm;
  prepared: PreparedPeriod;
}): Promise<ReturnVersionRecord> {
  if (!args.prepared.readiness.ready) {
    throw new Error('This return is not ready yet. Please deal with what is still outstanding.');
  }

  const payload = args.form === 'GSTR-3B' ? args.prepared.gstr3b : args.prepared.gstr1;
  const now = new Date().toISOString();

  const version: ReturnVersionRecord = {
    id: newId(),
    returnPeriodId: returnPeriodId(args.prepared.gstin, args.form, args.prepared.period),
    gstin: args.prepared.gstin,
    form: args.form,
    period: args.prepared.period,
    versionNumber: 1,
    createdAt: now,
    createdByUid: args.uid,
    sourceFingerprint: args.prepared.fingerprint,
    payloadHash: payloadHash(payload),
    rulePackVersion: args.prepared.rulePackVersion,
    schemaVersion: null,
    workings: payload as unknown as Record<string, unknown>,
    approvedByUid: args.uid,
    approvedAt: now,
    invalidatedAt: null,
    invalidationReason: null,
  };

  await saveReturnVersion(args.business.id, version);
  await upsertReturnPeriod(args.business.id, {
    id: version.returnPeriodId,
    gstin: version.gstin,
    form: args.form,
    period: args.prepared.period,
    status: 'ready',
    approvedVersionId: version.id,
    currentVersionId: version.id,
  });

  await recordAudit(args.business.id, {
    actorUid: args.uid,
    actorKind: 'user',
    action: 'gst.approved-for-filing',
    subjectType: 'return-version',
    subjectId: version.id,
    detail: { form: args.form, period: args.prepared.period, payloadHash: version.payloadHash },
  });

  return version;
}

/** Whether an approval still describes the current state of the records. */
export function checkApprovalStillValid(
  version: ReturnVersionRecord,
  currentFingerprint: string,
): { valid: boolean; reason: string | null } {
  if (version.invalidatedAt) return { valid: false, reason: version.invalidationReason };
  if (version.sourceFingerprint !== currentFingerprint) {
    return {
      valid: false,
      reason: 'The sales or purchases behind this return changed after it was approved.',
    };
  }
  return { valid: true, reason: null };
}

export function describePeriod(period: MonthPeriod): string {
  return formatPeriodLong(period);
}
