import 'server-only';

import type { BusinessRecord } from '@/lib/domain/types';
import { pool } from '@/server/db/pool';
import { businessesForUser } from '@/server/repos/business';

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

  // Membership and the business in one query: no membership row, no business.
  const { rows } = await pool().query<{ data: BusinessRecord; member: boolean }>(
    `select b.data, exists(select 1 from members m where m.business_id = b.id and m.uid = $2) as member
     from businesses b where b.id = $1`,
    [businessId, user.uid],
  );
  if (!rows[0]) throw new NotAuthorisedError();
  if (!rows[0].member) throw new NotAuthorisedError();

  return { user, businessId, business: { ...rows[0].data, id: businessId } };
}

/** Businesses the signed-in user may reach, for the account switcher. */
export async function listMyBusinesses(): Promise<BusinessRecord[]> {
  const user = await requireUser();
  return businessesForUser(user.uid);
}
