import { redirect } from 'next/navigation';

import { currentUser } from '@/server/auth/session';

import { SignInForm } from './SignInForm';

export const dynamic = 'force-dynamic';

export default async function SignInPage() {
  if (await currentUser()) redirect('/home');

  return (
    <main className="page" style={{ maxWidth: 420, paddingTop: 48, minHeight: '100dvh', justifyContent: 'center' }}>
      <div className="stack" style={{ gap: 6, marginBottom: 8 }}>
        <h1 style={{ fontSize: '1.75rem' }}>EasyBills</h1>
        <p className="muted">Create a bill, share it and track payment.</p>
      </div>
      <SignInForm />
    </main>
  );
}
