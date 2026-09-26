import { openAccess } from '@/lib/env';
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
            <strong>Sign-in is switched off.</strong> Anyone with this web address can see and change
            these bills. Do not put a real business&rsquo;s books here.
          </div>
        )}
        {business.isDemo && (
          <div className="demo-banner" role="status">
            Demo business — these are sample records, not your real bills
          </div>
        )}
        {children}
      </div>
      <TabBar showGst={showGst} />
    </div>
  );
}
