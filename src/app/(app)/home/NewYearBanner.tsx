'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { startNewYearAction } from '@/app/actions/business';
import { t } from '@/lib/copy';

/** April. Bill numbers start from 1 again, once the owner says so. */
export function NewYearBanner({ businessId, fy, prefix }: { businessId: string; fy: string; prefix: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="notice notice--info">
      <span className="notice__icon" aria-hidden="true">i</span>
      <div className="stack stack--tight grow">
        <strong>{t('year.title', { fy })}</strong>
        <span className="small">{t('year.body', { prefix: prefix || '—' })}</span>
        <button
          type="button"
          className="btn btn--primary btn--small"
          style={{ alignSelf: 'flex-start' }}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await startNewYearAction(businessId);
            setBusy(false);
            router.refresh();
          }}
        >
          {t('year.go')}
        </button>
      </div>
    </div>
  );
}
