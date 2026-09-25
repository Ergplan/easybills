'use server';

import { requireUser } from '@/server/auth/session';
import { seedDemoBusiness } from '@/server/services/seed';

import { ok, toActionError, type ActionResult } from './common';

/**
 * Create a demo business for the signed-in user.
 *
 * Demo and real records are kept visibly separate: a demo business is a business
 * of its own, flagged `isDemo`, which the shell announces on every screen. No
 * sample record is ever mixed into a real ledger.
 */
export async function seedDemoBusinessAction(): Promise<ActionResult<{ businessId: string }>> {
  try {
    const user = await requireUser();
    const business = await seedDemoBusiness({
      uid: user.uid,
      email: user.email,
      displayName: user.name,
      profile: 'repair',
    });
    return ok({ businessId: business.id });
  } catch (error) {
    return toActionError(error);
  }
}
