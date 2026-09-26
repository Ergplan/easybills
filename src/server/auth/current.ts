import 'server-only';

import { redirect } from 'next/navigation';

import { openAccess } from '@/lib/env';
import type { BusinessRecord } from '@/lib/domain/types';
import { usersCol, businessDoc, membersCol } from '@/server/firebase/paths';
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
 */
export async function requireCurrentContext(): Promise<CurrentContext> {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const userSnap = await usersCol().doc(user.uid).get();
  let ids = (userSnap.data()?.businessIds as string[] | undefined) ?? [];

  // In open access there is nobody to complete a setup form, and an empty app
  // shows nothing worth looking at. The test user gets the sample business on
  // first visit -- the same one "Try a demo business" creates, flagged isDemo,
  // so its records are never mistaken for real ones.
  if (!ids.length && openAccess()) {
    const seeded = await seedDemoBusiness({
      uid: user.uid,
      email: user.email,
      displayName: user.name,
      profile: 'repair',
    });
    ids = [seeded.id];
  }

  if (!ids.length) redirect('/start');

  const snaps = await Promise.all(ids.map((id) => businessDoc(id).get()));
  const all = snaps
    .filter((s) => s.exists)
    .map((s) => ({ id: s.id, ...(s.data() as Omit<BusinessRecord, 'id'>) }));
  if (!all.length) redirect('/start');

  // Re-check membership of the business we are about to serve. The list on the
  // user record is a convenience index; the membership document is the authority.
  const business = all[0]!;
  const member = await membersCol(business.id).doc(user.uid).get();
  if (!member.exists) redirect('/start');

  return { user, business, allBusinesses: all };
}
