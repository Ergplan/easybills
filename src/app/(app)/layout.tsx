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

  return (
    <div className="app-shell">
      <SideNav businessName={business.legalName} />
      <div className="app-shell__main">
        {business.isDemo && (
          <div className="demo-banner" role="status">
            Demo business — these are sample records, not your real bills
          </div>
        )}
        {children}
      </div>
      <TabBar />
    </div>
  );
}
