import 'server-only';

import type { MonthPeriod } from '@/lib/dates';
import type { BusinessRecord } from '@/lib/domain/types';
import {
  duplicateKey,
  hashFile,
  parseExternalSaleCsv,
  parseGstr2bCsv,
  parseSupplierBillCsv,
} from '@/lib/gst-returns/import';
import type {
  ExternalSaleRecord,
  GstStatementSnapshotRecord,
  ImportBatchRecord,
  SupplierBillRecord,
} from '@/lib/gst-returns/types';
import { recordAudit } from '@/server/services/audit';

import {
  existingDuplicateKeys,
  findImportByHash,
  newId,
  recordImportBatch,
  saveExternalSales,
  saveSnapshot,
  saveSupplierBills,
} from './repo';

/**
 * Import logic, separate from the server action that wraps it.
 *
 * The action's job is authorisation and shaping the response; this is the
 * behaviour. Keeping them apart means the duplicate-detection rules can be
 * tested directly, without a request context, which is where the bugs that
 * matter would hide.
 */

export interface SupplierImportResult {
  imported: number;
  duplicates: number;
  rejected: number;
  errors: Array<{ row: number; message: string }>;
  alreadyImported: boolean;
  batchId: string | null;
}

export async function importSupplierBills(args: {
  businessId: string;
  uid: string;
  filename: string;
  contents: string;
  period: MonthPeriod;
}): Promise<SupplierImportResult> {
  const fileHash = hashFile(args.contents);

  // The same FILE, imported again, is a no-op rather than a doubling.
  const priorImport = await findImportByHash(args.businessId, fileHash);
  if (priorImport) {
    return {
      imported: 0,
      duplicates: priorImport.rowsImported,
      rejected: 0,
      errors: [],
      alreadyImported: true,
      batchId: priorImport.id,
    };
  }

  const parsed = parseSupplierBillCsv(args.contents);
  // ...and the same BILL, arriving in a different file, is skipped too.
  const existingKeys = await existingDuplicateKeys(args.businessId, args.period);

  const toSave: SupplierBillRecord[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  let duplicates = 0;
  const batchId = newId();
  const now = new Date().toISOString();

  for (const row of parsed) {
    if (!row.value) {
      errors.push({ row: row.rowNumber, message: row.error ?? 'Could not read this row.' });
      continue;
    }
    const key = duplicateKey(row.value.supplierGstin, row.value.documentNumber);
    if (existingKeys.has(key)) {
      duplicates += 1;
      continue;
    }
    existingKeys.add(key);

    toSave.push({
      id: newId(),
      supplierGstin: row.value.supplierGstin,
      supplierName: row.value.supplierName,
      documentNumber: row.value.documentNumber,
      matchKey: row.value.matchKey,
      documentDate: row.value.documentDate,
      documentType: row.value.documentType,
      period: args.period,
      taxableValuePaise: row.value.taxableValuePaise,
      cgstPaise: row.value.cgstPaise,
      sgstPaise: row.value.sgstPaise,
      igstPaise: row.value.igstPaise,
      cessPaise: row.value.cessPaise,
      // Nothing is claimed on import. A person decides, later, per bill.
      itcEligibility: 'not-reviewed',
      eligibleCgstPaise: 0,
      eligibleSgstPaise: 0,
      eligibleIgstPaise: 0,
      eligibleCessPaise: 0,
      eligibilityNote: null,
      eligibilityReviewedByUid: null,
      eligibilityReviewedAt: null,
      reverseCharge: row.value.reverseCharge,
      source: 'csv-import',
      importBatchId: batchId,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (toSave.length) await saveSupplierBills(args.businessId, toSave);

  const batch: ImportBatchRecord = {
    id: batchId,
    kind: 'supplier-bills',
    filename: args.filename,
    fileHash,
    sizeBytes: Buffer.byteLength(args.contents),
    period: args.period,
    rowsSeen: parsed.length,
    rowsImported: toSave.length,
    rowsSkippedDuplicate: duplicates,
    rowsRejected: errors.length,
    errors: errors.slice(0, 50),
    importedByUid: args.uid,
    importedAt: now,
  };
  await recordImportBatch(args.businessId, batch);

  return { imported: toSave.length, duplicates, rejected: errors.length, errors, alreadyImported: false, batchId };
}

export interface ExternalSalesImportResult {
  imported: number;
  duplicates: number;
  rejected: number;
  alreadyImported: boolean;
}

export async function importExternalSales(args: {
  businessId: string;
  uid: string;
  filename: string;
  contents: string;
  period: MonthPeriod;
}): Promise<ExternalSalesImportResult> {
  const fileHash = hashFile(args.contents);
  const prior = await findImportByHash(args.businessId, fileHash);
  if (prior) return { imported: 0, duplicates: prior.rowsImported, rejected: 0, alreadyImported: true };

  const parsed = parseExternalSaleCsv(args.contents);
  const batchId = newId();
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const toSave: ExternalSaleRecord[] = [];
  let duplicates = 0;
  let rejected = 0;

  for (const row of parsed) {
    if (!row.value) {
      rejected += 1;
      continue;
    }
    const key = duplicateKey(row.value.customerGstin, row.value.documentNumber);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    toSave.push({
      id: newId(),
      // The supplier's own number, preserved. We never renumber someone else's
      // invoice -- that number is what appears in the portal's records.
      documentNumber: row.value.documentNumber,
      matchKey: row.value.matchKey,
      documentDate: row.value.documentDate,
      period: args.period,
      customerGstin: row.value.customerGstin,
      customerName: row.value.customerName,
      placeOfSupplyStateCode: row.value.placeOfSupplyStateCode,
      documentType: row.value.documentType,
      taxableValuePaise: row.value.taxableValuePaise,
      cgstPaise: row.value.cgstPaise,
      sgstPaise: row.value.sgstPaise,
      igstPaise: row.value.igstPaise,
      cessPaise: row.value.cessPaise,
      taxRateBp: row.value.taxRateBp,
      source: 'csv-import',
      importBatchId: batchId,
      createdAt: now,
    });
  }

  if (toSave.length) await saveExternalSales(args.businessId, toSave);
  await recordImportBatch(args.businessId, {
    id: batchId,
    kind: 'external-sales',
    filename: args.filename,
    fileHash,
    sizeBytes: Buffer.byteLength(args.contents),
    period: args.period,
    rowsSeen: parsed.length,
    rowsImported: toSave.length,
    rowsSkippedDuplicate: duplicates,
    rowsRejected: rejected,
    errors: [],
    importedByUid: args.uid,
    importedAt: now,
  });

  return { imported: toSave.length, duplicates, rejected, alreadyImported: false };
}

export async function importGstr2b(args: {
  business: BusinessRecord;
  uid: string;
  filename: string;
  contents: string;
  period: MonthPeriod;
  generatedAt: string | null;
}): Promise<{ rows: number }> {
  const gstin = args.business.gstReturns?.gstin;
  if (!gstin) throw new Error('Please finish GST setup first.');

  const parsed = parseGstr2bCsv(args.contents);
  const rows = parsed.filter((p) => p.value).map((p) => p.value!);
  if (!rows.length) {
    throw new Error('We could not read any rows from that file. Please check it is the GSTR-2B export.');
  }

  const snapshot: GstStatementSnapshotRecord = {
    id: newId(),
    gstin,
    statementType: 'GSTR-2B',
    period: args.period,
    // Provenance: when the PORTAL made it, when we took it, and its hash.
    generatedAt: args.generatedAt,
    importedAt: new Date().toISOString(),
    importedByUid: args.uid,
    fileHash: hashFile(args.contents),
    importVersion: 1,
    rows,
    supersededBySnapshotId: null,
  };
  await saveSnapshot(args.business.id, snapshot);

  await recordAudit(args.business.id, {
    actorUid: args.uid,
    actorKind: 'user',
    action: 'gst.statement-imported',
    subjectType: 'gst-statement',
    subjectId: snapshot.id,
    detail: { period: args.period, rows: rows.length },
  });

  return { rows: rows.length };
}
