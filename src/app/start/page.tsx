import { redirect } from 'next/navigation';

import { currentUser } from '@/server/auth/session';
import { usersCol } from '@/server/firebase/paths';

import { StartForm } from './StartForm';

export const dynamic = 'force-dynamic';

/**
 * The only thing asked before billing can start: the business name.
 *
 * GST status, address, numbering and bank details are all collected later --
 * before the FIRST ISSUE, not before the first draft. An owner can open this
 * app and be typing a bill within seconds.
 */
export default async function StartPage() {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const snap = await usersCol().doc(user.uid).get();
  const ids = (snap.data()?.businessIds as string[] | undefined) ?? [];
  if (ids.length) redirect('/home');

  return (
    <main className="page" style={{ maxWidth: 480, paddingTop: 40 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1>What is your business called?</h1>
        <p className="muted">This is the name your customers will see on the bill. You can change it later.</p>
      </div>
      <StartForm />
    </main>
  );
}
