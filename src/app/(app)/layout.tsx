import { t } from '@/lib/copy';
import { openAccess, voiceConfig } from '@/lib/env';
import { VoiceProvider } from '@/components/voice/VoiceProvider';
import { gstTabVisible } from '@/lib/domain/gst-tab';
import { requireCurrentContext } from '@/server/auth/current';

import { SideNav, TabBar } from '@/components/TabBar';

export const dynamic = 'force-dynamic';

/**
 * One shell, two shapes.
 *
 * On a phone the three destinations sit along the bottom, under the thumb. In a
 * browser window wide enough that the bottom edge is a long way from where the
 * eye already is, they move to a rail down the side and the content gets the
 * rest. The markup is the same either way; only CSS chooses, so there is no
 * second layout to keep in step and no width at which the app has no navigation.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { business } = await requireCurrentContext();
  const showGst = gstTabVisible(business);

  return (
    <div className="app-shell">
      <SideNav businessName={business.legalName} showGst={showGst} />
      <div className="app-shell__main">
        {/* Two different warnings, and both can be true at once. One is about
            the records; the other is about who can reach them. */}
        {openAccess() && (
          <div className="open-access-banner" role="alert">
            <strong>{t('banner.openAccess.title')}</strong> {t('banner.openAccess')}
          </div>
        )}
        {business.isDemo && (
          <div className="demo-banner" role="status">
            {t('banner.demo')}
          </div>
        )}
        <VoiceProvider businessId={business.id} enabled={voiceConfig().enabled}>
          {children}
        </VoiceProvider>
      </div>
      <TabBar showGst={showGst} />
    </div>
  );
}
