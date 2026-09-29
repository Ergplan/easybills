'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { removeUploadAction } from '@/app/actions/ask';
import { t } from '@/lib/copy';

export function RemoveUpload({ businessId, documentId }: { businessId: string; documentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn--ghost btn--small"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await removeUploadAction(businessId, documentId);
        router.refresh();
        setBusy(false);
      }}
    >
      {t('ask.uploads.remove')}
    </button>
  );
}
