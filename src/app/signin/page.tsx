import { redirect } from 'next/navigation';

import { t } from '@/lib/copy';
import { currentUser } from '@/server/auth/session';

import { PhoneSignIn } from './PhoneSignIn';

export const dynamic = 'force-dynamic';

export default async function SignInPage() {
  if (await currentUser()) redirect('/home');

  return (
    <main className="page signin" style={{ maxWidth: 420, minHeight: '100dvh', justifyContent: 'center' }}>
      <div className="stack" style={{ gap: 4, marginBottom: 8 }}>
        <p className="signin__brand">{t('app.name')}</p>
        <p className="muted">{t('app.tagline')}</p>
      </div>
      <PhoneSignIn />
    </main>
  );
}
