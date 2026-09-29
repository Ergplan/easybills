import { randomUUID } from 'node:crypto';

import { todayIst } from '@/lib/dates';
import type { AuditEventRecord, BusinessRecord, InvoiceLine } from '@/lib/domain/types';
import { parseMoney, parsePercent, parseQuantity } from '@/lib/money';
import { pool } from '@/server/db/pool';
import { createBusiness, updateBusiness } from '@/server/repos/business';

/** A business that is fully set up and allowed to issue GST bills. */
export async function makeGstBusiness(overrides: Partial<BusinessRecord> = {}): Promise<BusinessRecord> {
  const uid = `uid-${randomUUID()}`;
  const business = await createBusiness({
    uid,
    email: `${uid}@example.test`,
    displayName: 'Test Owner',
    legalName: overrides.legalName ?? 'Test Services',
  });
  return updateBusiness(business.id, uid, {
    stateCode: '27',
    registrationType: 'regular',
    gstin: '27AAPFU0939F1ZV',
    addressLine1: '1 Test Lane',
    city: 'Mumbai',
    eInvoicingSelfDeclaredNotApplicable: true,
    numberingConfirmed: true,
    ...overrides,
  });
}

export async function makeUnregisteredBusiness(): Promise<BusinessRecord> {
  const uid = `uid-${randomUUID()}`;
  const business = await createBusiness({
    uid,
    email: `${uid}@example.test`,
    displayName: 'Test Owner',
    legalName: 'Home Kitchen',
  });
  return updateBusiness(business.id, uid, {
    stateCode: '29',
    registrationType: 'not-registered',
    numberingConfirmed: true,
  });
}

export async function ownerUidOf(business: BusinessRecord): Promise<string> {
  const { rows } = await pool().query<{ uid: string }>('select uid from members where business_id = $1 limit 1', [
    business.id,
  ]);
  return rows[0]!.uid;
}

/** Audit rows of one kind, oldest first. */
export async function auditEvents(businessId: string, action: string): Promise<AuditEventRecord[]> {
  const { rows } = await pool().query<{ data: AuditEventRecord }>(
    "select data from audit_events where business_id = $1 and data->>'action' = $2 order by at",
    [businessId, action],
  );
  return rows.map((r) => r.data);
}

export function line(
  description: string,
  qty: string,
  price: string,
  ratePercent = '0',
  extra: Partial<InvoiceLine> = {},
): InvoiceLine {
  return {
    id: randomUUID(),
    description,
    quantityMilli: parseQuantity(qty),
    unitPricePaise: parseMoney(price),
    discountPaise: 0,
    taxRateBp: parsePercent(ratePercent),
    // A fixture states its rate, so it counts as chosen unless a test overrides.
    taxRateChosen: true,
    cessRateBp: 0,
    priceIncludesTax: false,
    unit: null,
    hsnCode: null,
    savedItemId: null,
    ...extra,
  };
}

export const TODAY = todayIst();
