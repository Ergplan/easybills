import 'server-only';

import { randomUUID } from 'node:crypto';

import { financialYearOf, todayIst } from '@/lib/dates';
import type { BusinessRecord, MemberRecord, UserRecord } from '@/lib/domain/types';
import { pool, withTx, type Db } from '@/server/db/pool';
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

  // The business, its owner's membership and the owner's index of businesses
  // land together or not at all.
  await withTx(async (tx) => {
    await tx.query('insert into businesses (id, data) values ($1, $2)', [id, JSON.stringify(business)]);
    await tx.query('insert into members (business_id, uid, data) values ($1, $2, $3)', [
      id,
      args.uid,
      JSON.stringify({ uid: args.uid, role: 'owner', createdAt: now } satisfies MemberRecord),
    ]);
    const user: UserRecord = {
      uid: args.uid,
      phone: args.phone ?? null,
      email: args.email,
      displayName: args.displayName,
      businessIds: [id],
      createdAt: now,
      lastSeenAt: now,
    };
    await tx.query(
      `insert into users (uid, data) values ($1, $2)
       on conflict (uid) do update set data = users.data || jsonb_build_object(
         'businessIds', (users.data->'businessIds') || to_jsonb($3::text),
         'lastSeenAt', $4::text)`,
      [args.uid, JSON.stringify(user), id, now],
    );
    await recordAudit(
      id,
      {
        actorUid: args.uid,
        actorKind: 'user',
        action: 'business.created',
        subjectType: 'business',
        subjectId: id,
        detail: { isDemo: Boolean(args.isDemo) },
      },
      tx,
    );
  });
  return business;
}

export async function getBusiness(businessId: string, db: Db = pool()): Promise<BusinessRecord | null> {
  const { rows } = await db.query<{ data: BusinessRecord }>('select data from businesses where id = $1', [businessId]);
  return rows[0] ? { ...rows[0].data, id: businessId } : null;
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
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const { rows } = await pool().query<{ data: BusinessRecord }>(
    'update businesses set data = data || $2::jsonb where id = $1 returning data',
    [businessId, JSON.stringify({ ...clean, updatedAt: now })],
  );
  if (!rows[0]) throw new Error('Business disappeared during update');
  await recordAudit(businessId, {
    actorUid: uid,
    actorKind: 'user',
    action: 'business.updated',
    subjectType: 'business',
    subjectId: businessId,
    // Field names only -- never the values, which may include bank details.
    detail: { fields: Object.keys(patch) },
  });
  return { ...rows[0].data, id: businessId };
}

export async function getUserRecord(uid: string): Promise<UserRecord | null> {
  const { rows } = await pool().query<{ data: UserRecord }>('select data from users where uid = $1', [uid]);
  return rows[0]?.data ?? null;
}

export async function ensureUserRecord(args: {
  uid: string;
  phone?: string | null;
  email: string | null;
  displayName: string | null;
}): Promise<UserRecord> {
  const now = new Date().toISOString();
  const record: UserRecord = {
    uid: args.uid,
    phone: args.phone ?? null,
    email: args.email,
    displayName: args.displayName,
    businessIds: [],
    createdAt: now,
    lastSeenAt: now,
  };
  // The phone is kept current: an account that predates phone sign-in has
  // none on record until its owner signs in this way.
  const patch = args.phone ? { lastSeenAt: now, phone: args.phone } : { lastSeenAt: now };
  const { rows } = await pool().query<{ data: UserRecord }>(
    `insert into users (uid, data) values ($1, $2)
     on conflict (uid) do update set data = users.data || $3::jsonb
     returning data`,
    [args.uid, JSON.stringify(record), JSON.stringify(patch)],
  );
  return rows[0]!.data;
}

/** Whether `uid` is a member of `businessId`. The authority for every access check. */
export async function isMember(businessId: string, uid: string, db: Db = pool()): Promise<boolean> {
  const { rowCount } = await db.query('select 1 from members where business_id = $1 and uid = $2', [businessId, uid]);
  return (rowCount ?? 0) > 0;
}

/** The businesses `uid` is a member of, oldest first (the first is the one they work in). */
export async function businessesForUser(uid: string): Promise<BusinessRecord[]> {
  const { rows } = await pool().query<{ id: string; data: BusinessRecord }>(
    `select b.id, b.data from members m join businesses b on b.id = m.business_id
     where m.uid = $1 order by b.created_at asc, b.id asc`,
    [uid],
  );
  return rows.map((r) => ({ ...r.data, id: r.id }));
}

export async function countBusinesses(): Promise<number> {
  const { rows } = await pool().query<{ n: string }>('select count(*) as n from businesses');
  return Number(rows[0]!.n);
}
