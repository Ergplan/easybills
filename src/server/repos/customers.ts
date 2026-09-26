import 'server-only';

import { randomUUID } from 'node:crypto';

import type { CustomerRecord, InvoiceParty } from '@/lib/domain/types';
import { customersCol } from '@/server/firebase/paths';
import { recordAudit } from '@/server/services/audit';

export async function listCustomers(
  businessId: string,
  opts: { includeArchived?: boolean; limit?: number } = {},
): Promise<CustomerRecord[]> {
  const snap = await customersCol(businessId).orderBy('name').limit(opts.limit ?? 500).get();
  const all = snap.docs.map((d) => d.data() as CustomerRecord);
  return opts.includeArchived ? all : all.filter((c) => !c.archived);
}

/** Recent customers first -- what the editor's picker shows before any typing. */
export async function recentCustomers(businessId: string, limit = 8): Promise<CustomerRecord[]> {
  const snap = await customersCol(businessId)
    .where('archived', '==', false)
    .orderBy('lastBilledAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as CustomerRecord);
}

export async function getCustomer(businessId: string, customerId: string): Promise<CustomerRecord | null> {
  const snap = await customersCol(businessId).doc(customerId).get();
  return snap.exists ? (snap.data() as CustomerRecord) : null;
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
  await customersCol(businessId).doc(record.id).set(record);
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
  await customersCol(businessId).doc(customerId).update({ ...patch, updatedAt: new Date().toISOString() });
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
  await customersCol(businessId).doc(customerId).update({ lastBilledAt: new Date().toISOString() });
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
