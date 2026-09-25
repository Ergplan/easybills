import 'server-only';

import { randomUUID } from 'node:crypto';

import { periodBounds, type MonthPeriod } from '@/lib/dates';
import type { InvoiceRecord } from '@/lib/domain/types';
import type {
  ExternalSaleRecord,
  GstStatementSnapshotRecord,
  ImportBatchRecord,
  ReconciliationFindingRecord,
  ReturnForm,
  ReturnPeriodRecord,
  ReturnVersionRecord,
  SupplierBillRecord,
} from '@/lib/gst-returns/types';
import { db } from '@/server/firebase/admin';
import {
  externalSalesCol,
  findingsCol,
  importBatchesCol,
  invoicesCol,
  returnPeriodsCol,
  returnPeriodId,
  returnVersionsCol,
  statementSnapshotsCol,
  supplierBillsCol,
} from '@/server/firebase/paths';

export async function listSupplierBills(businessId: string, period: MonthPeriod): Promise<SupplierBillRecord[]> {
  const snap = await supplierBillsCol(businessId).where('period', '==', period).limit(1000).get();
  return snap.docs.map((d) => d.data() as SupplierBillRecord);
}

export async function listExternalSales(businessId: string, period: MonthPeriod): Promise<ExternalSaleRecord[]> {
  const snap = await externalSalesCol(businessId).where('period', '==', period).limit(1000).get();
  return snap.docs.map((d) => d.data() as ExternalSaleRecord);
}

/** Issued invoices whose supply falls in the period. Drafts are never included. */
export async function listIssuedInvoicesForPeriod(businessId: string, period: MonthPeriod): Promise<InvoiceRecord[]> {
  const { start, end } = periodBounds(period);
  const snap = await invoicesCol(businessId)
    .where('status', '==', 'issued')
    .where('issueDate', '>=', start)
    .where('issueDate', '<=', end)
    .limit(2000)
    .get();
  return snap.docs.map((d) => d.data() as InvoiceRecord);
}

export async function latestSnapshot(
  businessId: string,
  gstin: string,
  period: MonthPeriod,
): Promise<GstStatementSnapshotRecord | null> {
  const snap = await statementSnapshotsCol(businessId)
    .where('gstin', '==', gstin)
    .where('period', '==', period)
    .where('statementType', '==', 'GSTR-2B')
    .orderBy('importVersion', 'desc')
    .limit(1)
    .get();
  return snap.empty ? null : (snap.docs[0]!.data() as GstStatementSnapshotRecord);
}

export async function saveSnapshot(businessId: string, snapshot: GstStatementSnapshotRecord): Promise<void> {
  // A newer import supersedes the previous one rather than replacing it, so the
  // history of what was relied on stays intact.
  const previous = await latestSnapshot(businessId, snapshot.gstin, snapshot.period);
  const batch = db().batch();
  if (previous) {
    batch.update(statementSnapshotsCol(businessId).doc(previous.id), { supersededBySnapshotId: snapshot.id });
  }
  batch.set(statementSnapshotsCol(businessId).doc(snapshot.id), {
    ...snapshot,
    importVersion: (previous?.importVersion ?? 0) + 1,
  });
  await batch.commit();
}

export async function replaceFindings(
  businessId: string,
  period: MonthPeriod,
  findings: ReconciliationFindingRecord[],
): Promise<void> {
  const existing = await findingsCol(businessId).where('period', '==', period).limit(1000).get();

  // Carry forward the owner's recorded decisions: re-running the checks must not
  // erase a reason someone already wrote down for the same problem.
  const priorDecisions = new Map<string, ReconciliationFindingRecord>();
  for (const doc of existing.docs) {
    const f = doc.data() as ReconciliationFindingRecord;
    if (f.resolved) priorDecisions.set(`${f.kind}|${f.documentNumber ?? ''}|${f.supplierGstin ?? ''}`, f);
  }

  const batch = db().batch();
  for (const doc of existing.docs) batch.delete(doc.ref);
  for (const finding of findings) {
    const key = `${finding.kind}|${finding.documentNumber ?? ''}|${finding.supplierGstin ?? ''}`;
    const prior = priorDecisions.get(key);
    batch.set(findingsCol(businessId).doc(finding.id), {
      ...finding,
      ...(prior
        ? {
            resolved: true,
            reviewedByUid: prior.reviewedByUid,
            reviewedAt: prior.reviewedAt,
            reviewReason: prior.reviewReason,
          }
        : {}),
    });
  }
  await batch.commit();
}

export async function listFindings(businessId: string, period: MonthPeriod): Promise<ReconciliationFindingRecord[]> {
  const snap = await findingsCol(businessId).where('period', '==', period).limit(1000).get();
  return snap.docs.map((d) => d.data() as ReconciliationFindingRecord);
}

export async function resolveFinding(
  businessId: string,
  findingId: string,
  uid: string,
  reason: string,
): Promise<void> {
  await findingsCol(businessId).doc(findingId).update({
    resolved: true,
    reviewedByUid: uid,
    reviewedAt: new Date().toISOString(),
    reviewReason: reason,
  });
}

export async function getReturnPeriod(
  businessId: string,
  gstin: string,
  form: ReturnForm,
  period: MonthPeriod,
): Promise<ReturnPeriodRecord | null> {
  const snap = await returnPeriodsCol(businessId).doc(returnPeriodId(gstin, form, period)).get();
  return snap.exists ? (snap.data() as ReturnPeriodRecord) : null;
}

export async function upsertReturnPeriod(businessId: string, record: Partial<ReturnPeriodRecord> & { id: string }): Promise<void> {
  await returnPeriodsCol(businessId).doc(record.id).set({ ...record, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function saveReturnVersion(businessId: string, version: ReturnVersionRecord): Promise<void> {
  await returnVersionsCol(businessId).doc(version.id).set(version);
}

export async function getReturnVersion(businessId: string, versionId: string): Promise<ReturnVersionRecord | null> {
  const snap = await returnVersionsCol(businessId).doc(versionId).get();
  return snap.exists ? (snap.data() as ReturnVersionRecord) : null;
}

/**
 * Invalidate an approval whose source data has moved.
 *
 * Called whenever a prepared version is re-checked and its fingerprint no
 * longer matches. This is what stops an approval from travelling to a payload
 * the owner never saw.
 */
export async function invalidateApproval(
  businessId: string,
  versionId: string,
  reason: string,
): Promise<void> {
  await returnVersionsCol(businessId).doc(versionId).update({
    invalidatedAt: new Date().toISOString(),
    invalidationReason: reason,
  });
}

export async function recordImportBatch(businessId: string, batch: ImportBatchRecord): Promise<void> {
  await importBatchesCol(businessId).doc(batch.id).set(batch);
}

/** Has this exact file been imported before? */
export async function findImportByHash(businessId: string, fileHash: string): Promise<ImportBatchRecord | null> {
  const snap = await importBatchesCol(businessId).where('fileHash', '==', fileHash).limit(1).get();
  return snap.empty ? null : (snap.docs[0]!.data() as ImportBatchRecord);
}

export async function existingDuplicateKeys(businessId: string, period: MonthPeriod): Promise<Set<string>> {
  const bills = await listSupplierBills(businessId, period);
  return new Set(bills.map((b) => `${b.supplierGstin ?? 'unknown'}|${b.matchKey}`));
}

export async function saveSupplierBills(businessId: string, bills: SupplierBillRecord[]): Promise<void> {
  const batch = db().batch();
  for (const bill of bills) batch.set(supplierBillsCol(businessId).doc(bill.id), bill);
  await batch.commit();
}

export async function saveExternalSales(businessId: string, sales: ExternalSaleRecord[]): Promise<void> {
  const batch = db().batch();
  for (const sale of sales) batch.set(externalSalesCol(businessId).doc(sale.id), sale);
  await batch.commit();
}

export async function reviewItc(args: {
  businessId: string;
  uid: string;
  billId: string;
  eligibility: SupplierBillRecord['itcEligibility'];
  eligibleCgstPaise: number;
  eligibleSgstPaise: number;
  eligibleIgstPaise: number;
  eligibleCessPaise: number;
  note: string | null;
}): Promise<void> {
  await supplierBillsCol(args.businessId).doc(args.billId).update({
    itcEligibility: args.eligibility,
    eligibleCgstPaise: args.eligibleCgstPaise,
    eligibleSgstPaise: args.eligibleSgstPaise,
    eligibleIgstPaise: args.eligibleIgstPaise,
    eligibleCessPaise: args.eligibleCessPaise,
    eligibilityNote: args.note,
    eligibilityReviewedByUid: args.uid,
    eligibilityReviewedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export function newId(): string {
  return randomUUID();
}
