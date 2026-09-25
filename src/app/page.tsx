import { redirect } from 'next/navigation';

import { currentUser } from '@/server/auth/session';

export default async function Root() {
  const user = await currentUser();
  redirect(user ? '/home' : '/signin');
}
