import 'server-only';

import { membersCol, businessDoc } from '@/server/firebase/paths';
import type { BusinessRecord } from '@/lib/domain/types';

import { requireUser, type SessionUser } from './session';

/**
 * Tenant isolation, enforced in exactly one place.
 *
 * Every server entry point that touches business data calls `requireBusiness`.
 * It re-reads the membership document on each request rather than trusting a
 * business id from the client or a stale claim in the session, so revoking
 * access takes effect immediately and a guessed business id gets nothing.
 */

export class NotAuthorisedError extends Error {
  constructor(message = 'You do not have access to this business.') {
    super(message);
    this.name = 'NotAuthorisedError';
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not found.') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export interface BusinessContext {
  user: SessionUser;
  businessId: string;
  business: BusinessRecord;
}

export async function requireBusiness(businessId: string): Promise<BusinessContext> {
  const user = await requireUser();
  if (!businessId || typeof businessId !== 'string') throw new NotAuthorisedError();

  const membership = await membersCol(businessId).doc(user.uid).get();
  if (!membership.exists) throw new NotAuthorisedError();

  const snap = await businessDoc(businessId).get();
  if (!snap.exists) throw new NotFoundError('Business not found.');

  return { user, businessId, business: { id: snap.id, ...(snap.data() as Omit<BusinessRecord, 'id'>) } };
}

/** Businesses the signed-in user may reach, for the account switcher. */
export async function listMyBusinesses(): Promise<BusinessRecord[]> {
  const user = await requireUser();
  const { usersCol } = await import('@/server/firebase/paths');
  const userSnap = await usersCol().doc(user.uid).get();
  const ids = (userSnap.data()?.businessIds as string[] | undefined) ?? [];
  if (!ids.length) return [];
  const docs = await Promise.all(ids.map((id) => businessDoc(id).get()));
  return docs
    .filter((d) => d.exists)
    .map((d) => ({ id: d.id, ...(d.data() as Omit<BusinessRecord, 'id'>) }));
}
