import Link from 'next/link';

import { NumberingForm } from '@/components/NumberingForm';
import { ProfileForm } from '@/components/ProfileForm';
import { t } from '@/lib/copy';
import { openAccess } from '@/lib/env';
import { requireCurrentContext } from '@/server/auth/current';

import { SignOut } from './SignOut';

export const dynamic = 'force-dynamic';

/**
 * "Aap": the same five fields as the first day, to change later. Everything
 * the older, fuller settings screen holds (bank account, numbering, logo)
 * stays reachable behind one link, for the owner who needs it.
 */
export default async function YouPage() {
  const { business, user } = await requireCurrentContext();

  return (
    <main className="page">
      <div className="stack" style={{ gap: 4, paddingTop: 8 }}>
        <h1>{t('you.title')}</h1>
        <p className="muted">{t('you.sub')}</p>
      </div>
      <ProfileForm
        mode="edit"
        businessId={business.id}
        phone={user.phone ?? business.phone}
        initial={{
          name: business.legalName,
          phone: business.phone ?? '',
          gstin: business.gstin ?? '',
          upiId: business.bank.upiId ?? '',
          city: business.city ?? '',
          stateCode: business.stateCode ?? '',
        }}
      />
      <NumberingForm businessId={business.id} numbering={business.numbering} fy={business.activeFinancialYear} />
      <div className="stack stack--tight" style={{ alignItems: 'flex-start' }}>
        <Link href="/customers" className="btn btn--ghost">{t('customer.list.title')}</Link>
        <Link href="/settings" className="btn btn--ghost">{t('you.more')}</Link>
        {!openAccess() && <SignOut />}
      </div>
    </main>
  );
}
