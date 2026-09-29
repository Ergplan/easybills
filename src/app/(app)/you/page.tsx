import { AapForm, type AppInfo } from '@/components/AapForm';
import { TopBar } from '@/components/TopBar';
import { t } from '@/lib/copy';
import { openAccess, voiceConfig } from '@/lib/env';
import { requireCurrentContext } from '@/server/auth/current';
import { doclingHealth } from '@/server/import/docling';
import { pdfCapability } from '@/server/pdf/render';

import { SignOut } from './SignOut';

export const dynamic = 'force-dynamic';

/**
 * "Aap": everything about the owner's business on one screen, with one Save.
 * It took over what the old English settings page held (address, bank
 * account, numbering, payment terms) and says, folded away, what this
 * installation can and cannot do.
 */
export default async function YouPage() {
  const { business, user } = await requireCurrentContext();
  const [pdf, photos] = await Promise.all([pdfCapability().catch(() => ({ ok: false })), doclingHealth()]);
  const info: AppInfo = {
    signInOn: !openAccess(),
    pdf: pdf.ok ? 'on' : 'broken',
    voice: voiceConfig().enabled ? 'on' : 'off',
    photos: photos === 'ok' ? 'on' : photos === 'off' ? 'off' : 'broken',
  };

  return (
    <>
      <TopBar title={t('aap.title')} sub={t('aap.sub')} back={{ href: '/home' }} />
      <main className="page">
        <AapForm
          businessId={business.id}
          phone={user.phone ?? business.phone}
          minNextNumber={business.numbering.nextNumber > 1 ? business.numbering.nextNumber : 1}
          fy={business.activeFinancialYear}
          padding={business.numbering.padding}
          info={info}
          initial={{
            name: business.legalName,
            phone: business.phone ?? '',
            gstin: business.gstin ?? '',
            upiId: business.bank.upiId ?? '',
            city: business.city ?? '',
            stateCode: business.stateCode ?? '',
            eInvoicingApplies: business.gstin ? (business.eInvoicingSelfDeclaredNotApplicable ? false : null) : null,
            addressLine1: business.addressLine1 ?? '',
            pincode: business.pincode ?? '',
            email: business.email ?? '',
            accountHolderName: business.bank.accountHolderName ?? '',
            accountNumber: business.bank.accountNumber ?? '',
            ifsc: business.bank.ifsc ?? '',
            bankName: business.bank.bankName ?? '',
            prefix: business.numbering.prefix,
            nextNumber: String(business.numbering.nextNumber),
            includeFinancialYear: business.numbering.includeFinancialYear,
            paymentTermsDays: String([0, 7, 15, 30].includes(business.defaultPaymentTermsDays) ? business.defaultPaymentTermsDays : 7),
          }}
        />
        {!openAccess() && <SignOut />}
      </main>
    </>
  );
}
