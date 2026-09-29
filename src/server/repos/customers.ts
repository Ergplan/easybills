import 'server-only';

import { randomUUID } from 'node:crypto';

import type { CustomerRecord, InvoiceParty } from '@/lib/domain/types';
import { getDoc, insertDoc, patchDoc, queryDocs } from '@/server/db/docs';
import { pool } from '@/server/db/pool';
import { recordAudit } from '@/server/services/audit';

export async function listCustomers(
  businessId: string,
  opts: { includeArchived?: boolean; limit?: number } = {},
): Promise<CustomerRecord[]> {
  return queryDocs<CustomerRecord>(pool(), 'customers', businessId, {
    where: opts.includeArchived ? undefined : 'not archived',
    order: 'name asc',
    limit: opts.limit ?? 500,
  });
}

/** Recent customers first -- what the editor's picker shows before any typing. */
export async function recentCustomers(businessId: string, limit = 8): Promise<CustomerRecord[]> {
  return queryDocs<CustomerRecord>(pool(), 'customers', businessId, {
    where: 'not archived and last_billed_at is not null',
    order: 'last_billed_at desc',
    limit,
  });
}

export async function getCustomer(businessId: string, customerId: string): Promise<CustomerRecord | null> {
  return getDoc<CustomerRecord>(pool(), 'customers', businessId, customerId);
}

type NewCustomer = Omit<
  CustomerRecord,
  'id' | 'archived' | 'createdAt' | 'updatedAt' | 'lastBilledAt' | 'contactPerson' | 'language' | 'languageSource'
> &
  Partial<Pick<CustomerRecord, 'contactPerson' | 'language' | 'languageSource'>>;

export async function createCustomer(businessId: string, uid: string, input: NewCustomer): Promise<CustomerRecord> {
  const now = new Date().toISOString();
  const record: CustomerRecord = {
    // Who to greet, and in what language, are questions most callers have no
    // answer to yet. Null is the honest default: the owner's own language, and
    // a greeting worked out from the name.
    contactPerson: null,
    language: null,
    languageSource: null,
    ...input,
    id: randomUUID(),
    archived: false,
    createdAt: now,
    updatedAt: now,
    lastBilledAt: null,
  };
  await insertDoc(pool(), 'customers', businessId, record.id, record);
  await recordAudit(businessId, {
    actorUid: uid,
    actorKind: 'user',
    action: 'customer.created',
    subjectType: 'customer',
    subjectId: record.id,
    detail: null,
  });
  return record;
}

/**
 * Customer edits apply prospectively. An issued invoice keeps the name, address
 * and GSTIN it was issued with, because those live in its own snapshot.
 */
export async function updateCustomer(
  businessId: string,
  uid: string,
  customerId: string,
  patch: Partial<Omit<CustomerRecord, 'id' | 'createdAt'>>,
): Promise<void> {
  const found = await patchDoc(pool(), 'customers', businessId, customerId, { ...patch, updatedAt: new Date().toISOString() });
  if (!found) throw new Error('That customer no longer exists.');
  await recordAudit(businessId, {
    actorUid: uid,
    actorKind: 'user',
    action: 'customer.updated',
    subjectType: 'customer',
    subjectId: customerId,
    detail: { fields: Object.keys(patch) },
  });
}

export async function markBilled(businessId: string, customerId: string): Promise<void> {
  await patchDoc(pool(), 'customers', businessId, customerId, { lastBilledAt: new Date().toISOString() });
}

export function customerToParty(customer: CustomerRecord): InvoiceParty {
  return {
    customerId: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    addressLine1: customer.addressLine1,
    addressLine2: customer.addressLine2,
    city: customer.city,
    pincode: customer.pincode,
    stateCode: customer.stateCode,
    gstin: customer.gstin,
    pan: customer.pan,
  };
}
