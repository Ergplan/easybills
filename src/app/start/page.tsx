import { redirect } from 'next/navigation';

import { t } from '@/lib/copy';
import { voiceConfig } from '@/lib/env';
import { currentUser } from '@/server/auth/session';
import { businessesForUser } from '@/server/repos/business';

import { GuideButton } from '@/components/guide/GuideButton';
import { StartWizard } from '@/components/StartWizard';
import { VoiceProvider } from '@/components/voice/VoiceProvider';

export const dynamic = 'force-dynamic';

/**
 * The one stretch between signing in and the first bill: a question at a
 * time, which voice can ask out loud and fill in.
 *
 * Name, phone, GST number (or not), UPI, and where they are. The address, the
 * bank account and the bill numbering all have defaults that are right for
 * most people; they can be changed under "Aap" later, never here.
 */
export default async function StartPage() {
  const user = await currentUser();
  if (!user) redirect('/signin');

  if ((await businessesForUser(user.uid)).length) redirect('/home');

  return (
    <VoiceProvider businessId={null} enabled={voiceConfig().enabled}>
      <main className="page" style={{ maxWidth: 480, paddingTop: 32 }}>
        <div className="stack" style={{ gap: 4 }}>
          <div className="row row--between">
            <h1>{t('you.title')}</h1>
            <GuideButton />
          </div>
          <p className="muted">{t('you.sub')}</p>
        </div>
        <StartWizard phone={user.phone} />
      </main>
    </VoiceProvider>
  );
}
