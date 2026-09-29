import { TopBar } from '@/components/TopBar';
import { t } from '@/lib/copy';
import { formatDateShort } from '@/lib/dates';
import { askConfig } from '@/lib/env';
import { requireCurrentContext } from '@/server/auth/current';
import { listUploads } from '@/server/search/index-records';

import { AskBox } from './AskBox';
import { RemoveUpload } from './RemoveUpload';

export const dynamic = 'force-dynamic';

/**
 * "Poocho": a question about the owner's own records, answered from them.
 * Below it, the old bills whose text is kept for this, each removable.
 */
export default async function AskPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { business } = await requireCurrentContext();
  const { q } = await searchParams;
  const uploads = await listUploads(business.id);
  const config = askConfig();

  return (
    <>
      <TopBar title={t('ask.title')} back={{ href: '/home' }} />
      <main className="page stack">
        <p className="muted">{t('ask.sub')}</p>
        <AskBox businessId={business.id} withModel={Boolean(config.enabled && config.apiKey)} initial={q ?? ''} />

        <section className="card stack stack--tight" aria-labelledby="uploads-heading">
          <h2 id="uploads-heading" className="card__title">{t('ask.uploads.title')}</h2>
          <p className="card__sub">{uploads.length ? t('ask.uploads.sub') : t('ask.uploads.none')}</p>
          {uploads.length > 0 && (
            <div className="rows">
              {uploads.map((u) => (
                <div key={u.id} className="row-line">
                  <div className="row-line__link">
                    <div className="row-line__name">{u.title}</div>
                    <div className="row-line__meta">{formatDateShort(u.createdAt.slice(0, 10))}</div>
                  </div>
                  <RemoveUpload businessId={business.id} documentId={u.id} />
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
