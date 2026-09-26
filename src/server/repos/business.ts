import 'server-only';

import { randomUUID } from 'node:crypto';

import { financialYearOf, todayIst } from '@/lib/dates';
import type { BusinessRecord, MemberRecord, UserRecord } from '@/lib/domain/types';
import { db, FieldValue } from '@/server/firebase/admin';
import { businessDoc, businessesCol, membersCol, usersCol } from '@/server/firebase/paths';
import { recordAudit } from '@/server/services/audit';

/**
 * A new business starts in a deliberately incomplete state.
 *
 * The owner can begin a draft immediately: only `legalName` is required up front,
 * and GST status stays "not sure" until they confirm it. That is what lets the
 * product promise "start billing now, finish setup before you issue" without
 * lying about what is known.
 */
export function blankBusiness(args: {
  id: string;
  legalName: string;
  isDemo?: boolean;
  profile?: Partial<BusinessProfile>;
}): BusinessRecord {
  const now = new Date().toISOString();
  const p = args.profile ?? {};
  return {
    id: args.id,
    legalName: args.legalName,
    tradeName: null,
    addressLine1: null,
    addressLine2: null,
    city: p.city ?? null,
    pincode: null,
    stateCode: p.stateCode ?? null,
    phone: p.phone ?? null,
    email: null,
    registrationType: p.registrationType ?? 'not-sure',
    gstin: p.gstin ?? null,
    pan: null,
    declaredAggregateTurnoverPaise: null,
    eInvoicingSelfDeclaredNotApplicable: false,
    bank: { accountHolderName: null, accountNumber: null, ifsc: null, bankName: null, upiId: p.upiId ?? null },
    logoDataUrl: null,
    signatureDataUrl: null,
    accentColour: null,
    activeFinancialYear: financialYearOf(todayIst()),
    numbering: { prefix: 'INV-', nextNumber: 1, padding: 3, includeFinancialYear: false },
    numberingConfirmed: false,
    issuesInvoicesElsewhere: null,
    defaultPaymentTermsDays: 7,
    defaultTaxRateBp: null,
    roundToNearestRupee: true,
    isDemo: args.isDemo ?? false,
    gstReturns: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * What the owner tells us on the first screen (see `lib/domain/profile.ts`).
 * All of it optional here so a test or a demo can create a bare business.
 */
export interface BusinessProfile {
  phone: string | null;
  gstin: string | null;
  upiId: string | null;
  city: string | null;
  stateCode: string | null;
  registrationType: BusinessRecord['registrationType'];
}

export async function createBusiness(args: {
  uid: string;
  phone?: string | null;
  email: string | null;
  displayName: string | null;
  legalName: string;
  isDemo?: boolean;
  profile?: Partial<BusinessProfile>;
}): Promise<BusinessRecord> {
  const id = randomUUID();
  const business = blankBusiness({ id, legalName: args.legalName, isDemo: args.isDemo, profile: args.profile });
  const now = new Date().toISOString();

  const batch = db().batch();
  batch.set(businessDoc(id), business);
  batch.set(membersCol(id).doc(args.uid), { uid: args.uid, role: 'owner', createdAt: now } satisfies MemberRecord);

  const userRef = usersCol().doc(args.uid);
  const userSnap = await userRef.get();
  if (userSnap.exists) {
    batch.update(userRef, { businessIds: FieldValue.arrayUnion(id), lastSeenAt: now });
  } else {
    batch.set(userRef, {
      uid: args.uid,
      phone: args.phone ?? null,
      email: args.email,
      displayName: args.displayName,
      businessIds: [id],
      createdAt: now,
      lastSeenAt: now,
    } satisfies UserRecord);
  }
  await batch.commit();
  await recordAudit(id, {
    actorUid: args.uid,
    actorKind: 'user',
    action: 'business.created',
    subjectType: 'business',
    subjectId: id,
    detail: { isDemo: Boolean(args.isDemo) },
  });
  return business;
}

export async function getBusiness(businessId: string): Promise<BusinessRecord | null> {
  const snap = await businessDoc(businessId).get();
  return snap.exists ? ({ id: snap.id, ...(snap.data() as Omit<BusinessRecord, 'id'>) }) : null;
}

/**
 * Profile edits apply PROSPECTIVELY.
 *
 * Nothing here touches an issued invoice: those read from their own snapshot.
 * Changing the business address does not rewrite last month's PDF.
 */
export async function updateBusiness(
  businessId: string,
  uid: string,
  patch: Partial<Omit<BusinessRecord, 'id' | 'createdAt'>>,
): Promise<BusinessRecord> {
  const now = new Date().toISOString();
  await businessDoc(businessId).update({ ...patch, updatedAt: now });
  const updated = await getBusiness(businessId);
  if (!updated) throw new Error('Business disappeared during update');
  await recordAudit(businessId, {
    actorUid: uid,
    actorKind: 'user',
    action: 'business.updated',
    subjectType: 'business',
    subjectId: businessId,
    // Field names only -- never the values, which may include bank details.
    detail: { fields: Object.keys(patch) },
  });
  return updated;
}

export async function ensureUserRecord(args: {
  uid: string;
  phone?: string | null;
  email: string | null;
  displayName: string | null;
}): Promise<UserRecord> {
  const ref = usersCol().doc(args.uid);
  const now = new Date().toISOString();
  const snap = await ref.get();
  if (snap.exists) {
    // The phone is kept current: an account that predates phone sign-in
    // has none on record until its owner signs in this way.
    const patch = args.phone ? { lastSeenAt: now, phone: args.phone } : { lastSeenAt: now };
    await ref.update(patch);
    return { ...(snap.data() as UserRecord), ...patch };
  }
  const record: UserRecord = {
    uid: args.uid,
    phone: args.phone ?? null,
    email: args.email,
    displayName: args.displayName,
    businessIds: [],
    createdAt: now,
    lastSeenAt: now,
  };
  await ref.set(record);
  return record;
}

export async function countBusinesses(): Promise<number> {
  const snap = await businessesCol().count().get();
  return snap.data().count;
}
