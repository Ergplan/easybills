'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { t } from '@/lib/copy';
import { endServerSession } from '@/lib/firebase/client';

export function SignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn--ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await endServerSession();
        router.replace('/signin');
      }}
    >
      {t('you.logout')}
    </button>
  );
}
