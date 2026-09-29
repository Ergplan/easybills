import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';

import { openAccess } from '@/lib/env';
import type { BusinessRecord } from '@/lib/domain/types';
import { businessesForUser } from '@/server/repos/business';
import { seedDemoBusiness } from '@/server/services/seed';

import { currentUser, type SessionUser } from './session';

export interface CurrentContext {
  user: SessionUser;
  business: BusinessRecord;
  allBusinesses: BusinessRecord[];
}

/**
 * Resolve the signed-in user and the business they are working in.
 *
 * Redirects rather than throwing, because every page in the app group needs the
 * same two guarantees: somebody is signed in, and they have a business. A user
 * with no business goes to setup; a user with no session goes to sign-in.
 *
 * Wrapped in React's `cache`, which is not an optimisation so much as a repair.
 * The app layout asks this question and then so does the page inside it, so
 * every screen was resolving the same user and the same business twice, from
 * scratch. `cache` dedupes it
 * within a single request; a new request still re-reads and re-checks, so the
 * membership check is not weakened.
 */
export const requireCurrentContext = cache(async function requireCurrentContext(): Promise<CurrentContext> {
  const user = await currentUser();
  if (!user) redirect('/signin');

  // Membership is the authority: the businesses listed are exactly the ones
  // this user is a member of, read in the same query.
  let all = await businessesForUser(user.uid);

  // In open access there is nobody to complete a setup form, and an empty app
  // shows nothing worth looking at. The test user gets the sample business on
  // first visit -- the same one "Try a demo business" creates, flagged isDemo,
  // so its records are never mistaken for real ones.
  if (!all.length && openAccess()) {
    await seedDemoBusiness({
      uid: user.uid,
      email: user.email,
      displayName: user.name,
      profile: 'repair',
    });
    all = await businessesForUser(user.uid);
  }

  if (!all.length) redirect('/start');

  return { user, business: all[0]!, allBusinesses: all };
})
