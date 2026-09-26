import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';

import { openAccess } from '@/lib/env';
import type { BusinessRecord } from '@/lib/domain/types';
import { db } from '@/server/firebase/admin';
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
 *
 * Wrapped in React's `cache`, which is not an optimisation so much as a repair.
 * The app layout asks this question and then so does the page inside it, so
 * every screen was resolving the same user and the same business twice, from
 * scratch. Against a database on another continent that was half a second of
 * an owner's time spent learning something already known. `cache` dedupes it
 * within a single request; a new request still re-reads and re-checks, so the
 * membership check is not weakened.
 */
export const requireCurrentContext = cache(async function requireCurrentContext(): Promise<CurrentContext> {
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

  // The businesses AND the membership check in a single round trip.
  //
  // Membership of the first business is what the page will be served as, and
  // the first business is `ids[0]` -- known here without reading anything. So
  // the authority document can be fetched alongside the businesses rather than
  // after them. `getAll` is one request to Firestore; the sequential version
  // was two, and with the database on another continent that is a quarter of a
  // second of an owner's time for nothing.
  const businessRefs = ids.map((id) => businessDoc(id));
  const memberRef = membersCol(ids[0]!).doc(user.uid);
  const [memberSnap, ...snaps] = await db().getAll(memberRef, ...businessRefs);

  const all = snaps
    .filter((s) => s.exists)
    .map((s) => ({ id: s.id, ...(s.data() as Omit<BusinessRecord, 'id'>) }));
  if (!all.length) redirect('/start');

  // The list on the user record is a convenience index; the membership
  // document is the authority, and it is still checked before anything is served.
  if (!memberSnap!.exists) redirect('/start');

  return { user, business: all[0]!, allBusinesses: all };
})
