import 'server-only';

import { db } from './admin';

/**
 * Every business-owned collection hangs off `businesses/{businessId}`.
 *
 * Nesting is deliberate: it makes "which business does this record belong to?"
 * a property of the document PATH rather than of a field somebody might forget
 * to filter on. A query that omits the business id cannot compile.
 */

export const usersCol = () => db().collection('users');
export const businessesCol = () => db().collection('businesses');
export const businessDoc = (businessId: string) => businessesCol().doc(businessId);

const sub = (businessId: string, name: string) => businessDoc(businessId).collection(name);

export const membersCol = (b: string) => sub(b, 'members');
export const customersCol = (b: string) => sub(b, 'customers');
export const itemsCol = (b: string) => sub(b, 'items');
export const invoicesCol = (b: string) => sub(b, 'invoices');
export const paymentsCol = (b: string) => sub(b, 'payments');
export const adjustmentsCol = (b: string) => sub(b, 'adjustments');
export const schedulesCol = (b: string) => sub(b, 'schedules');
export const occurrencesCol = (b: string) => sub(b, 'occurrences');
export const countersCol = (b: string) => sub(b, 'counters');
export const auditCol = (b: string) => sub(b, 'auditEvents');
export const aiUsageCol = (b: string) => sub(b, 'aiUsage');

// GST return module -- isolated collections, scoped by business and GSTIN.
export const supplierBillsCol = (b: string) => sub(b, 'supplierBills');
export const importBatchesCol = (b: string) => sub(b, 'importBatches');
export const externalSalesCol = (b: string) => sub(b, 'externalSales');
export const statementSnapshotsCol = (b: string) => sub(b, 'gstStatementSnapshots');
export const findingsCol = (b: string) => sub(b, 'reconciliationFindings');
export const returnPeriodsCol = (b: string) => sub(b, 'returnPeriods');
export const returnVersionsCol = (b: string) => sub(b, 'returnVersions');
export const filingAttemptsCol = (b: string) => sub(b, 'filingAttempts');
export const acknowledgementsCol = (b: string) => sub(b, 'filingAcknowledgements');
export const consentsCol = (b: string) => sub(b, 'providerConsents');

/** Durable background jobs. Global, because the worker sweeps across businesses. */
export const jobsCol = () => db().collection('jobs');

/**
 * Deterministic document ids are how uniqueness is enforced without a UNIQUE
 * constraint. Firestore `create()` fails if the id already exists, so a
 * well-chosen id turns "at most one of these may exist" into a database
 * guarantee that survives concurrent workers, retries and restarts.
 */
export const occurrenceId = (scheduleId: string, period: string) => `${scheduleId}__${period}`;
export const counterId = (financialYear: string, seriesId: string) => `${seriesId}__${financialYear}`;
export const returnPeriodId = (gstin: string, form: string, period: string) => `${gstin}__${form}__${period}`;
