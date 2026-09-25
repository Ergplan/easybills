import Link from 'next/link';

import { requireCurrentContext } from '@/server/auth/current';

import { TabBar } from '@/components/TabBar';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { business } = await requireCurrentContext();

  return (
    <div className="app-shell">
      {business.isDemo && (
        <div className="demo-banner" role="status">
          Demo business — these are sample records, not your real bills
        </div>
      )}
      {children}
      <TabBar />
      <span className="sr-only">
        <Link href="/settings">Business settings</Link>
      </span>
    </div>
  );
}
