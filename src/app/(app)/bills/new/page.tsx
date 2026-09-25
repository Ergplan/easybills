import { requireCurrentContext } from '@/server/auth/current';
import { TopBar } from '@/components/TopBar';

import { NewBillChooser } from './NewBillChooser';

export const dynamic = 'force-dynamic';

export default async function NewBillPage() {
  const { business } = await requireCurrentContext();
  return (
    <>
      <TopBar title="Create bill" back={{ href: '/home' }} />
      <main className="page">
        <NewBillChooser businessName={business.legalName} />
      </main>
    </>
  );
}
