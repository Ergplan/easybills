import 'server-only';

import { randomUUID } from 'node:crypto';

import type { BilledEntry, ContractTerms } from '@/lib/domain/contract';
import type { InvoiceRecord, ProjectRecord } from '@/lib/domain/types';
import { getDoc, insertDoc, patchDoc, queryDocs } from '@/server/db/docs';
import { pool } from '@/server/db/pool';
import { recordAudit } from '@/server/services/audit';

/**
 * Contracts: the deal agreed once, billed against many times. What has been
 * billed is never stored here -- it is read from the bills themselves, so a
 * cancelled bill frees its instalment and nothing can drift out of step.
 */
export async function createProject(args: {
  businessId: string;
  uid: string;
  customerId: string;
  customerName: string;
  terms: ContractTerms;
  source: ProjectRecord['source'];
}): Promise<ProjectRecord> {
  const now = new Date().toISOString();
  const record: ProjectRecord = {
    id: randomUUID(),
    customerId: args.customerId,
    customerName: args.customerName,
    ...args.terms,
    source: args.source,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    createdByUid: args.uid,
  };
  await insertDoc(pool(), 'projects', args.businessId, record.id, record);
  await recordAudit(args.businessId, {
    actorUid: args.uid,
    actorKind: 'user',
    action: 'project.created',
    subjectType: 'project',
    subjectId: record.id,
    detail: { billing: record.billing, milestones: record.milestones.length },
  });
  return record;
}

export async function updateProjectTerms(businessId: string, uid: string, projectId: string, terms: ContractTerms): Promise<void> {
  await patchDoc(pool(), 'projects', businessId, projectId, { ...terms, updatedAt: new Date().toISOString() });
  await recordAudit(businessId, {
    actorUid: uid,
    actorKind: 'user',
    action: 'project.updated',
    subjectType: 'project',
    subjectId: projectId,
    detail: null,
  });
}

export async function getProject(businessId: string, projectId: string): Promise<ProjectRecord | null> {
  return getDoc<ProjectRecord>(pool(), 'projects', businessId, projectId);
}

export async function listProjectsForCustomer(businessId: string, customerId: string): Promise<ProjectRecord[]> {
  return queryDocs<ProjectRecord>(pool(), 'projects', businessId, {
    where: 'customer_id = $2',
    params: [customerId],
    order: "data->>'createdAt' desc",
    limit: 50,
  });
}

/** The bills raised against a contract, as the calculator reads them. */
export async function billsForProject(businessId: string, projectId: string): Promise<{ entries: BilledEntry[]; bills: InvoiceRecord[] }> {
  const bills = await queryDocs<InvoiceRecord>(pool(), 'invoices', businessId, {
    where: "project_id = $2 and status <> 'cancelled'",
    params: [projectId],
    limit: 200,
  });
  const entries: BilledEntry[] = bills
    .filter((b) => b.projectStage)
    .map((b) => ({
      invoiceId: b.id,
      number: b.number,
      milestoneId: b.projectStage!.milestoneId,
      basisPaise: b.projectStage!.basisPaise,
      cumulativeBp: b.projectStage!.cumulativeBp,
      status: b.status === 'issued' ? 'issued' : 'draft',
    }));
  return { entries, bills };
}
