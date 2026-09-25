import { randomUUID } from 'node:crypto';

import { todayIst } from '@/lib/dates';
import type { BusinessRecord, InvoiceLine } from '@/lib/domain/types';
import { parseMoney, parsePercent, parseQuantity } from '@/lib/money';
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
  const { membersCol } = await import('@/server/firebase/paths');
  const snap = await membersCol(business.id).limit(1).get();
  return snap.docs[0]!.id;
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
